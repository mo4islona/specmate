import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type AgentProvider,
  type AgentRole,
  type ProviderStatus,
  parseStageResult,
  ROLE_CONTRACTS,
  type StageJob,
  type StageOutcome,
} from '@specmate/core'
import { RESULT_FILE, SCRATCH_DIR } from '@specmate/workspace'
import type { ExecBackend, ExecResult } from './backend.ts'
import type { RunnerConfig } from './config.ts'

export type RunFailure = 'timeout' | 'provider_error' | 'no_result' | 'invalid_result'

/** A run that produced no usable result. The log is the diagnosis, so it travels with the error. */
export class StageRunError extends Error {
  constructor(
    readonly failure: RunFailure,
    readonly log: string,
    readonly exitCode: number,
    readonly durationMs: number,
    detail: string,
  ) {
    super(detail)
    this.name = 'StageRunError'
  }
}

export interface ClaudeProviderDeps {
  readonly config: RunnerConfig
  readonly backend: ExecBackend
}

/**
 * The provider CLI, invoked headless. Two channels come back: `RESULT.json` is
 * the role contract, and the CLI's own JSON envelope is the run's telemetry —
 * separate on purpose, so swapping providers changes how telemetry is read and
 * leaves the role contract alone.
 */
export class ClaudeCodeProvider implements AgentProvider {
  readonly id = 'claude-code' as const

  constructor(private readonly deps: ClaudeProviderDeps) {}

  argv(role: AgentRole): string[] {
    const { config } = this.deps
    const argv = [config.cli, '-p', '--output-format', 'json', '--model', config.model]
    // Nobody is present to answer a permission prompt; the container boundary
    // and the post-run scope check are the safety property, not the prompt.
    argv.push('--permission-mode', 'bypassPermissions')
    const disallowed = disallowedTools(role)
    if (disallowed.length > 0) argv.push('--disallowedTools', disallowed.join(','))

    return argv
  }

  async run(job: StageJob): Promise<StageOutcome> {
    const { config, backend } = this.deps
    const label = stageLabel(job)
    const scratch = join(job.workspacePath, SCRATCH_DIR, label)
    const resultPath = join(job.workspacePath, RESULT_FILE)

    await mkdir(scratch, { recursive: true })
    await writeFile(join(scratch, 'prompt.md'), job.prompt)
    // Scratch is excluded from commits, so a previous attempt's result outlives
    // both a crash and the discard before a retry. Reading it would answer for
    // an attempt that never wrote anything.
    await rm(resultPath, { force: true })

    const run = await backend.run({
      argv: this.argv(job.role),
      stdin: job.prompt,
      workspacePath: job.workspacePath,
      env: {},
      timeoutMs: job.timeoutMs || config.stageTimeoutMs,
      limits: { cpus: config.cpus, memory: config.memory },
      containerRuntime: job.needsContainerRuntime ?? false,
      environment: job.environment,
      label,
    })

    const log = `$ ${this.argv(job.role).join(' ')}\n\n${run.stdout}\n${run.stderr}`
    await writeFile(join(scratch, 'run.log'), log)

    if (run.timedOut) {
      throw new StageRunError(
        'timeout',
        log,
        run.exitCode,
        run.durationMs,
        `no result within ${job.timeoutMs}ms`,
      )
    }

    const raw = await Bun.file(resultPath)
      .text()
      .catch(() => null)
    if (raw === null) {
      const detail =
        run.exitCode === 0
          ? 'the run left no RESULT.json'
          : `provider exited ${run.exitCode} and left no RESULT.json`
      throw new StageRunError(
        run.exitCode === 0 ? 'no_result' : 'provider_error',
        log,
        run.exitCode,
        run.durationMs,
        detail,
      )
    }

    const parsed = parseStageResult(raw)
    if (!parsed.ok) {
      throw new StageRunError('invalid_result', log, run.exitCode, run.durationMs, parsed.error)
    }

    const usage = { ...parsed.value.usage, ...readTelemetry(run.stdout) }
    await writeFile(join(scratch, 'telemetry.json'), JSON.stringify(usage, null, 2))

    return {
      result: { ...parsed.value, usage },
      log,
      exitCode: run.exitCode,
      durationMs: run.durationMs,
    }
  }

  async healthcheck(): Promise<ProviderStatus> {
    const { config, backend } = this.deps
    // Never the current directory: a health check must not be able to leave a
    // stray file in whatever tree this process was started from.
    const scratch = await mkdtemp(join(tmpdir(), 'specmate-healthcheck-'))
    let run: ExecResult
    try {
      run = await backend.run({
        argv: [config.cli, '--version'],
        stdin: '',
        workspacePath: scratch,
        env: {},
        timeoutMs: 30_000,
        limits: { cpus: config.cpus, memory: config.memory },
        containerRuntime: false,
        label: 'healthcheck',
      })
    } catch (e) {
      await rm(scratch, { recursive: true, force: true })

      return { provider: this.id, auth: 'unknown', detail: (e as Error).message }
    }

    if (run.exitCode !== 0) {
      await rm(scratch, { recursive: true, force: true })

      return { provider: this.id, auth: 'unknown', detail: 'the provider CLI could not be run' }
    }

    const cliVersion = run.stdout.trim().split('\n')[0] ?? ''
    const auth = await this.checkSession(scratch)
    await rm(scratch, { recursive: true, force: true })

    return { provider: this.id, auth: auth.state, cliVersion, detail: auth.detail }
  }

  /**
   * Asks the CLI itself rather than inspecting files: the answer has to come
   * from the thing that will run the stage. Nothing from the run is echoed
   * back, so a token in the output cannot leak through the status.
   */
  private async checkSession(
    scratch: string,
  ): Promise<{ state: ProviderStatus['auth']; detail: string }> {
    const { config, backend } = this.deps
    const run = await backend
      .run({
        argv: [config.cli, '-p', '--output-format', 'json', '--model', config.model],
        stdin: 'Reply with the single word: ok',
        workspacePath: scratch,
        env: {},
        timeoutMs: 60_000,
        limits: { cpus: config.cpus, memory: config.memory },
        containerRuntime: false,
        label: 'healthcheck-session',
      })
      .catch(() => null)
    if (!run) return { state: 'unknown', detail: 'the session check could not be run' }

    if (run.exitCode === 0) return { state: 'ok', detail: 'the stored session answered' }

    const expired = /login|auth|credential|expired|unauthor/i.test(`${run.stdout}${run.stderr}`)

    return expired
      ? { state: 'expired', detail: 'the stored session was rejected; re-login is needed' }
      : { state: 'unknown', detail: `the session check exited ${run.exitCode}` }
  }
}

export function stageLabel(job: StageJob): string {
  return `${job.stageId}-${job.attempt}`
}

/**
 * Defence in depth only. A role that may not touch product code keeps its file
 * tools — its artifacts are files — but loses the shell, which is the tool that
 * turns "edit an artifact" into "run the build".
 */
export function disallowedTools(role: AgentRole): string[] {
  return ROLE_CONTRACTS[role].writesCode ? [] : ['Bash']
}

/** Telemetry is best-effort: a garbled envelope must not fail a good stage. */
export function readTelemetry(stdout: string): Record<string, number> {
  const envelope = parseEnvelope(stdout)
  if (!envelope) return {}

  const usage = isRecord(envelope.usage) ? envelope.usage : {}
  const telemetry: Record<string, number> = {}
  if (typeof usage.input_tokens === 'number') telemetry.input_tokens = usage.input_tokens
  if (typeof usage.output_tokens === 'number') telemetry.output_tokens = usage.output_tokens
  if (typeof envelope.total_cost_usd === 'number') telemetry.cost_usd = envelope.total_cost_usd

  return telemetry
}

function parseEnvelope(stdout: string): Record<string, unknown> | null {
  const trimmed = stdout.trim()
  if (!trimmed) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return null
  }

  // Some CLI versions emit a transcript array whose last entry is the result.
  const candidate = Array.isArray(parsed) ? parsed.at(-1) : parsed

  return isRecord(candidate) ? candidate : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
