import { mkdirSync, writeFileSync } from 'node:fs'
import { readdir, readFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ExecutionEnvironment, ResolvedToolchain } from '@specmate/core'
import {
  type ExecBackend,
  type ExecHandle,
  type ExecResult,
  type ExecSpec,
  spawnBoundedHandle,
} from './backend.ts'
import { configuredProviders, providerRuntime, type RunnerConfig } from './config.ts'

/**
 * Development only: the provider runs as a child of the orchestrator. It gets
 * an explicit environment and a deadline, but it shares the machine — which is
 * why configuring it in production is a startup failure, not a warning.
 */
export class LocalBackend implements ExecBackend {
  readonly id = 'local' as const

  constructor(private readonly config: RunnerConfig) {}

  async preflight(_workspaceRoot: string): Promise<string> {
    const found: string[] = []
    for (const provider of configuredProviders(this.config)) {
      const { cli } = providerRuntime(this.config, provider)
      const path = Bun.which(cli)
      if (!path) {
        throw new Error(`provider "${provider}" is configured but its CLI "${cli}" is not on PATH`)
      }

      found.push(`${provider} ${path}`)
    }

    return `local backend: ${found.join(', ')}`
  }

  async resolveEnvironment(_workspacePath: string, _image: string): Promise<ExecutionEnvironment> {
    return { image: 'local://host', toolchains: [] }
  }

  async repinImage(
    _image: string,
    toolchains: readonly ResolvedToolchain[],
  ): Promise<ExecutionEnvironment> {
    return { image: 'local://host', toolchains: [...toolchains] }
  }

  /** There are no images to lose: the provider runs as a child of this process. */
  async resolvesImage(_image: string): Promise<boolean> {
    return true
  }

  /**
   * The child is detached (its own process group), so it survives an
   * orchestrator crash. The pid file is what lets the restart sweep find and
   * kill it — the local counterpart of a container label.
   */
  start(spec: ExecSpec): ExecHandle {
    const pidFile = this.pidFile(spec)
    const execution = spawnBoundedHandle({
      argv: spec.argv,
      stdin: spec.stdin,
      cwd: spec.workspacePath,
      env: this.env(spec),
      timeoutMs: spec.timeoutMs,
      outputLimitBytes: this.config.logBytesLimit,
      onSpawn: pidFile ? (pid) => recordAgentPid(pidFile, pid, spec.labels ?? {}) : undefined,
      onActivityLine: spec.onActivityLine,
    })

    return {
      result: execution.result.finally(async () => {
        if (pidFile) await rm(pidFile, { force: true })
      }),
      cancel: () => execution.cancel(),
    }
  }

  run(spec: ExecSpec): Promise<ExecResult> {
    return this.start(spec).result
  }

  private pidFile(spec: ExecSpec): string | null {
    if (!this.config.pidDir) return null

    const safe = spec.label.replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 80)

    return join(this.config.pidDir, `${safe}.json`)
  }

  /**
   * Explicit rather than inherited: the developer's session lives in their own
   * HOME, but nothing else of the orchestrator's environment — the database URL
   * above all — reaches the provider.
   */
  private env(spec: ExecSpec): Record<string, string> {
    const env: Record<string, string> = {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: process.env.HOME ?? '',
    }
    for (const name of providerRuntime(this.config, spec.provider).forwardEnv) {
      const value = process.env[name]
      if (value !== undefined) env[name] = value
    }

    return { ...env, ...spec.env }
  }
}

interface AgentPidRecord {
  readonly pid: number
  readonly labels: Readonly<Record<string, string>>
}

/** Synchronous on purpose: the window between spawn and record must not exist. */
function recordAgentPid(path: string, pid: number, labels: Readonly<Record<string, string>>): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify({ pid, labels } satisfies AgentPidRecord))
}

/**
 * The restart sweep's arm for the in-process backend: read the pid files the
 * runs left behind, kill the matching process groups, drop the files. Best
 * effort by design — the agent may have exited on its own.
 */
export async function killLocalAgents(
  pidDir: string,
  labels: Readonly<Record<string, string>>,
): Promise<string[]> {
  const entries = await readdir(pidDir).catch(() => [] as string[])
  const killed: string[] = []

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue
    const path = join(pidDir, entry)
    const record = await readAgentPid(path)
    if (!record) continue

    const matches = Object.entries(labels).every(([key, value]) => record.labels[key] === value)
    if (!matches) continue

    if (killAgentGroup(record.pid)) killed.push(`pid ${record.pid}`)
    await rm(path, { force: true })
  }

  return killed
}

async function readAgentPid(path: string): Promise<AgentPidRecord | null> {
  const raw = await readFile(path, 'utf8').catch(() => null)
  if (raw === null) return null

  try {
    const parsed = JSON.parse(raw) as AgentPidRecord
    if (typeof parsed.pid !== 'number' || typeof parsed.labels !== 'object') return null

    return parsed
  } catch {
    return null
  }
}

/** The group first, so whatever the agent spawned dies with it. */
function killAgentGroup(pid: number): boolean {
  try {
    process.kill(-pid, 'SIGKILL')

    return true
  } catch {
    try {
      process.kill(pid, 'SIGKILL')

      return true
    } catch {
      return false
    }
  }
}
