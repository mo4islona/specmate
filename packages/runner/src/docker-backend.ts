import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type ExecBackend, type ExecResult, type ExecSpec, spawnBounded } from './backend.ts'
import type { RunnerConfig } from './config.ts'

export const DOCKER_SOCKET = '/var/run/docker.sock'
const PREFLIGHT_MARKER = '.specmate-preflight'

export type ContainerKiller = (name: string) => void

/**
 * One container per stage, discarded when it ends. The container carries the
 * task's own working tree and the provider session, and nothing else: no
 * database URL, no repository key, no other task's files.
 *
 * The worktree is mounted at the path it already has, because the runtime
 * resolves that path on the host — mounting it anywhere else would leave host
 * and container disagreeing about what a path means.
 */
export class DockerBackend implements ExecBackend {
  readonly id = 'docker' as const

  constructor(
    private readonly config: RunnerConfig,
    private readonly kill: ContainerKiller = (name) => killContainer(config.dockerCli, name),
  ) {}

  argv(spec: ExecSpec): string[] {
    const { config } = this
    const argv = [
      config.dockerCli,
      'run',
      '--rm',
      '--interactive',
      '--name',
      containerName(spec.label),
      '--user',
      config.user,
      '--cpus',
      config.cpus,
      '--memory',
      config.memory,
      '--workdir',
      spec.workspacePath,
      '--volume',
      `${spec.workspacePath}:${spec.workspacePath}`,
      '--volume',
      `${config.authVolume}:${config.homeDir}`,
    ]
    // Harness containers are opt-in per stage; a stage that has not asked for a
    // runtime cannot reach one even though the host has it.
    if (spec.containerRuntime) argv.push('--volume', `${DOCKER_SOCKET}:${DOCKER_SOCKET}`)
    argv.push('--env', `HOME=${config.homeDir}`)
    // Name-only `--env` makes the runtime read the value from the client's
    // environment, so a forwarded secret never appears in the command line.
    for (const name of config.forwardEnv) argv.push('--env', name)
    for (const [key, value] of Object.entries(spec.env)) argv.push('--env', `${key}=${value}`)
    argv.push(spec.image ?? config.image, ...spec.argv)

    return argv
  }

  /**
   * Two things have to hold before any stage runs: the runtime answers, and a
   * path means the same thing to the orchestrator and to the host. The second
   * is the one that fails confusingly — a mismatch mounts an empty directory
   * and the agent reports an empty repository — so it is probed, not assumed.
   */
  async preflight(workspaceRoot: string): Promise<string> {
    const version = await spawnBounded({
      argv: [this.config.dockerCli, 'version', '--format', '{{.Server.Version}}'],
      stdin: '',
      cwd: process.cwd(),
      env: this.clientEnv(),
      timeoutMs: 30_000,
      outputLimitBytes: 64 * 1024,
    }).catch((e: Error) => {
      throw new Error(`the container runtime is unreachable: ${e.message}`)
    })
    if (version.exitCode !== 0) {
      throw new Error(`the container runtime is unreachable: ${version.stderr.trim()}`)
    }

    const token = randomUUID()
    const marker = join(workspaceRoot, PREFLIGHT_MARKER)
    await mkdir(workspaceRoot, { recursive: true })
    await writeFile(marker, token)
    try {
      const probe = await spawnBounded({
        argv: [
          this.config.dockerCli,
          'run',
          '--rm',
          '--user',
          this.config.user,
          '--volume',
          `${workspaceRoot}:${workspaceRoot}`,
          '--workdir',
          workspaceRoot,
          '--entrypoint',
          'cat',
          this.config.image,
          PREFLIGHT_MARKER,
        ],
        stdin: '',
        cwd: process.cwd(),
        env: this.clientEnv(),
        timeoutMs: 120_000,
        outputLimitBytes: 64 * 1024,
      })
      if (probe.exitCode !== 0) {
        throw new Error(
          `the runner image could not read ${workspaceRoot}: ${probe.stderr.trim() || `exit ${probe.exitCode}`}`,
        )
      }

      if (probe.stdout.trim() !== token) {
        throw new Error(
          `${workspaceRoot} resolves to a different directory on the host — set the workspace root to one absolute path used on both sides`,
        )
      }
    } finally {
      await rm(marker, { force: true })
    }

    return `docker backend: runtime ${version.stdout.trim()}, image ${this.config.image}`
  }

  async run(spec: ExecSpec): Promise<ExecResult> {
    const name = containerName(spec.label)
    return spawnBounded({
      argv: this.argv(spec),
      stdin: spec.stdin,
      // `docker run` is a client; the working directory that matters is the
      // container's, set with --workdir above.
      cwd: process.cwd(),
      env: this.clientEnv(),
      timeoutMs: spec.timeoutMs,
      outputLimitBytes: this.config.logBytesLimit,
      // Killing the client would leave the container running: the deadline has
      // to reach the container itself.
      onTimeout: () => this.kill(name),
    })
  }

  /** The client needs a socket and the names it forwards; nothing else. */
  private clientEnv(): Record<string, string> {
    const env: Record<string, string> = { PATH: process.env.PATH ?? '/usr/bin:/bin' }
    if (process.env.DOCKER_HOST) env.DOCKER_HOST = process.env.DOCKER_HOST
    for (const name of this.config.forwardEnv) {
      const value = process.env[name]
      if (value !== undefined) env[name] = value
    }

    return env
  }
}

/** Docker object names allow a narrow alphabet; a stage id is not one. */
export function containerName(label: string): string {
  const safe = label.replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 60)

  return `specmate-${safe}`
}

function killContainer(dockerCli: string, name: string): void {
  const child = spawn(dockerCli, ['kill', name], { stdio: 'ignore', detached: true })
  child.on('error', () => {
    // The container may already be gone; the run's exit code is the diagnosis.
  })
  child.unref()
}
