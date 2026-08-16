import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DeclaredToolchain, ExecutionEnvironment, ResolvedToolchain } from '@specmate/core'
import { detectToolchains } from '@specmate/workspace'
import { type ExecBackend, type ExecResult, type ExecSpec, spawnBounded } from './backend.ts'
import type { RunnerConfig } from './config.ts'
import {
  exactVersion,
  isVersionRange,
  parseRemoteVersions,
  resolvedToolchain,
  SUPPORTED_TOOLCHAINS,
  selectVersion,
  toolSpec,
  UnsupportedToolchainError,
} from './toolchains.ts'

export const DOCKER_SOCKET = '/var/run/docker.sock'
export const MISE_SHARED_ROOT = '/mise/shared'
export const MISE_SHARED_INSTALLS = `${MISE_SHARED_ROOT}/installs`
export const SPECMATE_TOOLCHAINS_ENV = 'SPECMATE_TOOLCHAINS'
const PREFLIGHT_MARKER = '.specmate-preflight'
const ENVIRONMENT_OUTPUT_LIMIT = 1024 * 1024

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
    ]
    for (const [key, value] of Object.entries(spec.labels ?? {})) {
      argv.push('--label', `${key}=${value}`)
    }
    argv.push(
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
      '--volume',
      `${config.toolchainsVolume}:${MISE_SHARED_ROOT}:ro`,
    )
    // Harness containers are opt-in per stage; a stage that has not asked for a
    // runtime cannot reach one even though the host has it.
    if (spec.containerRuntime) argv.push('--volume', `${DOCKER_SOCKET}:${DOCKER_SOCKET}`)
    // Name-only `--env` makes the runtime read the value from the client's
    // environment, so a forwarded secret never appears in the command line.
    for (const name of config.forwardEnv) argv.push('--env', name)
    for (const [key, value] of Object.entries(spec.env)) argv.push('--env', `${key}=${value}`)
    argv.push('--env', `HOME=${config.homeDir}`)
    argv.push(
      '--env',
      `${SPECMATE_TOOLCHAINS_ENV}=${JSON.stringify(spec.environment?.toolchains ?? [])}`,
    )
    argv.push(spec.environment?.image ?? config.image, ...spec.argv)

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

  async resolveEnvironment(workspacePath: string, image: string): Promise<ExecutionEnvironment> {
    const [immutableImage, declarations] = await Promise.all([
      this.resolveImage(image),
      detectToolchains(workspacePath),
    ])
    const toolchains = await Promise.all(
      declarations.map((toolchain) => this.resolveToolchain(immutableImage, toolchain)),
    )
    await this.installToolchains(immutableImage, toolchains)

    return { image: immutableImage, toolchains }
  }

  private async resolveImage(image: string): Promise<string> {
    if (isImmutableImageReference(image)) return image

    try {
      const inspected = await this.docker(['image', 'inspect', image], 60_000)
      return immutableImageFromInspection(image, inspected.stdout)
    } catch (error) {
      throw new Error(`could not pin runner image "${image}": ${ensureError(error).message}`)
    }
  }

  private async resolveToolchain(
    image: string,
    declaration: DeclaredToolchain,
  ): Promise<ResolvedToolchain> {
    if (!SUPPORTED_TOOLCHAINS.has(declaration.name)) {
      throw new UnsupportedToolchainError(declaration.name)
    }

    const exact = exactVersion(declaration.version)
    if (exact) return { name: declaration.name, version: exact }

    if (declaration.version && isVersionRange(declaration.version)) {
      const listed = await this.mise(image, ['ls-remote', '--json', declaration.name])
      return selectVersion(declaration, parseRemoteVersions(listed.stdout))
    }

    const request = declaration.version
      ? `${declaration.name}@${declaration.version}`
      : declaration.name
    const latest = await this.mise(image, ['latest', request])

    return resolvedToolchain(declaration, latest.stdout.trim())
  }

  private async installToolchains(
    image: string,
    toolchains: readonly ResolvedToolchain[],
  ): Promise<void> {
    if (toolchains.length === 0) return

    await this.docker(
      [
        'run',
        '--rm',
        '--user',
        this.config.user,
        '--volume',
        `${this.config.toolchainsVolume}:${MISE_SHARED_ROOT}`,
        '--env',
        `MISE_SHARED_INSTALL_DIRS=${MISE_SHARED_INSTALLS}`,
        '--entrypoint',
        '/usr/local/bin/mise',
        image,
        'install',
        '--yes',
        '--shared',
        MISE_SHARED_INSTALLS,
        ...toolchains.map(toolSpec),
      ],
      this.config.stageTimeoutMs,
    )
  }

  private mise(image: string, argv: readonly string[]): Promise<ExecResult> {
    return this.docker(
      [
        'run',
        '--rm',
        '--user',
        this.config.user,
        '--entrypoint',
        '/usr/local/bin/mise',
        image,
        ...argv,
      ],
      this.config.stageTimeoutMs,
    )
  }

  private async docker(argv: readonly string[], timeoutMs: number): Promise<ExecResult> {
    const result = await spawnBounded({
      argv: [this.config.dockerCli, ...argv],
      stdin: '',
      cwd: process.cwd(),
      env: this.clientEnv(),
      timeoutMs,
      outputLimitBytes: ENVIRONMENT_OUTPUT_LIMIT,
    })
    if (result.exitCode !== 0) {
      const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`
      throw new Error(`container runtime command failed: ${detail}`)
    }

    return result
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

export function isImmutableImageReference(image: string): boolean {
  return /(?:^|@)sha256:[a-f0-9]{64}$/i.test(image)
}

export function immutableImageFromInspection(image: string, raw: string): string {
  const parsed = JSON.parse(raw) as unknown
  if (!Array.isArray(parsed) || !isRecord(parsed[0])) throw new Error('invalid inspection output')
  const inspection = parsed[0]
  const repoDigests = Array.isArray(inspection.RepoDigests)
    ? inspection.RepoDigests.filter((value): value is string => typeof value === 'string')
    : []
  const repository = repositoryName(image)
  const matchingDigest = repoDigests.find((digest) => digest.startsWith(`${repository}@sha256:`))
  const id = typeof inspection.Id === 'string' ? inspection.Id : undefined
  const immutable = matchingDigest ?? id ?? repoDigests[0]
  if (!immutable || !isImmutableImageReference(immutable)) {
    throw new Error('inspection returned neither a repository digest nor an image ID')
  }

  return immutable
}

/** Docker object names allow a narrow alphabet; a stage id is not one. */
export function containerName(label: string): string {
  const safe = label.replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 60)

  return `specmate-${safe}`
}

/**
 * The restart sweep's arm: find containers carrying the given labels and kill
 * them. Best-effort by design — the container may have exited on its own, and
 * the runner's wall-clock timeout is the backstop for anything missed.
 */
export async function killContainersByLabels(
  config: RunnerConfig,
  labels: Readonly<Record<string, string>>,
): Promise<string[]> {
  const filters = Object.entries(labels).flatMap(([key, value]) => [
    '--filter',
    `label=${key}=${value}`,
  ])
  const found = await spawnBounded({
    argv: [config.dockerCli, 'ps', '--quiet', ...filters],
    stdin: '',
    cwd: process.cwd(),
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
    timeoutMs: 30_000,
    outputLimitBytes: 64 * 1024,
  }).catch(() => null)
  if (found?.exitCode !== 0) return []

  const ids = found.stdout
    .split('\n')
    .map((id) => id.trim())
    .filter((id) => id.length > 0)

  for (const id of ids) {
    await spawnBounded({
      argv: [config.dockerCli, 'kill', id],
      stdin: '',
      cwd: process.cwd(),
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
      timeoutMs: 30_000,
      outputLimitBytes: 16 * 1024,
    }).catch(() => null)
  }

  return ids
}

function killContainer(dockerCli: string, name: string): void {
  const child = spawn(dockerCli, ['kill', name], { stdio: 'ignore', detached: true })
  child.on('error', () => {
    // The container may already be gone; the run's exit code is the diagnosis.
  })
  child.unref()
}

function repositoryName(image: string): string {
  const slash = image.lastIndexOf('/')
  const colon = image.lastIndexOf(':')

  return colon > slash ? image.slice(0, colon) : image
}

function ensureError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
