import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DeclaredToolchain, ExecutionEnvironment, ResolvedToolchain } from '@specmate/core'
import { detectToolchains } from '@specmate/workspace'
import {
  ContainerRuntimeUnavailableError,
  type ExecBackend,
  type ExecHandle,
  type ExecResult,
  type ExecSpec,
  spawnBounded,
  spawnBoundedHandle,
} from './backend.ts'
import { configuredProviders, providerRuntime, type RunnerConfig } from './config.ts'
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

/**
 * Where a toolchain's caches live, as two directories rather than a table of
 * per-tool settings: `~/.cache` and `~/.local/share` are the XDG defaults, so
 * anything that follows the standard is already pointed at them and has to be
 * told nothing. That is what makes this hold for the next package manager and
 * the next language rather than only for the one that broke.
 *
 * They must come off the worktree's own filesystem. pnpm fills a project by
 * hardlinking out of its store, and a hardlink does not cross a filesystem —
 * handed a store it cannot link from, pnpm copies one into the project instead,
 * where nothing keeps it out of a stage commit.
 */
const CACHE_MOUNTS = [
  { host: 'xdg-cache', home: '.cache' },
  { host: 'xdg-data', home: '.local/share' },
  // What predates the standard and keeps a directory of its own. Nothing is
  // configured here either — each is mounted where its tool already looks, so
  // being absent from this list costs sharing, never correctness.
  { host: 'npm', home: '.npm' },
  { host: 'cargo-registry', home: '.cargo/registry' },
  { host: 'go-mod', home: 'go/pkg/mod' },
  { host: 'bun', home: '.bun/install/cache' },
] as const

/**
 * Every host directory the cache root holds. Shared across providers as well as
 * tasks, which is why the list stops where it does: what lands here is package
 * content addressed by its own hash. `~/.cargo` in full, `~/.m2`, `~/.gradle`
 * would each carry a registry credential too, and those stay in the provider's
 * own home where one task cannot read what another logged into.
 */
export function cacheDirs(cacheRoot: string): string[] {
  return CACHE_MOUNTS.map((mount) => join(cacheRoot, mount.host))
}
const PREFLIGHT_MARKER = '.specmate-preflight'
const ENVIRONMENT_OUTPUT_LIMIT = 1024 * 1024
const IMAGE_INSPECT_TIMEOUT_MS = 60_000

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
    const runtime = providerRuntime(config, spec.provider)
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
      `${runtime.authVolume}:${config.homeDir}`,
      '--volume',
      `${config.toolchainsVolume}:${MISE_SHARED_ROOT}:ro`,
    )
    // Over the top of the provider's home, which is the mount above: the
    // credential stays in its own volume, and only the cache directories under
    // it come from the filesystem the worktree is on. Read-write, unlike the
    // toolchains — filling these is what a stage's install is for.
    if (config.cacheRoot) {
      for (const mount of CACHE_MOUNTS) {
        const host = join(config.cacheRoot, mount.host)
        argv.push('--volume', `${host}:${config.homeDir}/${mount.home}`)
      }
    }
    // Harness containers are opt-in per stage; a stage that has not asked for a
    // runtime cannot reach one even though the host has it.
    if (spec.containerRuntime) argv.push('--volume', `${DOCKER_SOCKET}:${DOCKER_SOCKET}`)
    // Name-only `--env` makes the runtime read the value from the client's
    // environment, so a forwarded secret never appears in the command line.
    for (const name of runtime.forwardEnv) argv.push('--env', name)
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

    // Made here rather than left to the mount: a bind source the runtime has to
    // create belongs to root, and every stage runs unprivileged. This process
    // already owns the workspace root, so a directory it makes is writable.
    if (this.config.cacheRoot) {
      await Promise.all(
        cacheDirs(this.config.cacheRoot).map((dir) => mkdir(dir, { recursive: true })),
      )
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

    const clis = await this.probeProviderClis()

    return `docker backend: runtime ${version.stdout.trim()}, image ${this.config.image}, ${clis}`
  }

  /**
   * A configured provider whose CLI the image does not carry can only fail every
   * stage bound to it, one stage at a time. Asked here instead (AC-518).
   */
  private async probeProviderClis(): Promise<string> {
    const found: string[] = []
    for (const provider of configuredProviders(this.config)) {
      const { cli } = providerRuntime(this.config, provider)
      const probe = await spawnBounded({
        argv: [
          this.config.dockerCli,
          'run',
          '--rm',
          '--user',
          this.config.user,
          '--entrypoint',
          cli,
          this.config.image,
          '--version',
        ],
        stdin: '',
        cwd: process.cwd(),
        env: this.clientEnv(),
        timeoutMs: 120_000,
        outputLimitBytes: 64 * 1024,
      }).catch((e: Error) => ({ exitCode: -1, stdout: '', stderr: e.message }))
      if (probe.exitCode !== 0) {
        throw new Error(
          `provider "${provider}" is configured but its CLI "${cli}" is not in ${this.config.image}: ${probe.stderr.trim() || `exit ${probe.exitCode}`}`,
        )
      }

      found.push(`${provider} ${probe.stdout.trim().split('\n')[0] ?? ''}`.trim())
    }

    return found.join(', ')
  }

  start(spec: ExecSpec): ExecHandle {
    const name = containerName(spec.label)
    const runtime = providerRuntime(this.config, spec.provider)
    const execution = spawnBoundedHandle({
      argv: this.argv(spec),
      stdin: spec.stdin,
      // `docker run` is a client; the working directory that matters is the
      // container's, set with --workdir above.
      cwd: process.cwd(),
      env: this.clientEnv(runtime.forwardEnv),
      timeoutMs: spec.timeoutMs,
      outputLimitBytes: this.config.logBytesLimit,
      // Killing the client would leave the container running: the deadline has
      // to reach the container itself.
      onTimeout: () => this.kill(name),
      onActivityLine: spec.onActivityLine,
    })

    return {
      result: execution.result.then(withStartFailure),
      cancel: async () => {
        this.kill(name)
        await execution.cancel()
      },
    }
  }

  run(spec: ExecSpec): Promise<ExecResult> {
    return this.start(spec).result
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

  async repinImage(
    image: string,
    toolchains: readonly ResolvedToolchain[],
  ): Promise<ExecutionEnvironment> {
    const immutableImage = await this.resolveImage(image)
    await this.installToolchains(immutableImage, toolchains)

    return { image: immutableImage, toolchains: [...toolchains] }
  }

  /**
   * Only the runtime saying the image is not there is a "no". A socket that
   * refused, a daemon mid-restart or a client that is not installed are not
   * answers at all — and a re-pin driven by one of those spends the pin on an
   * outage, while a permanent failure ends a task for one.
   */
  async resolvesImage(image: string): Promise<boolean> {
    try {
      await this.docker(
        ['image', 'inspect', '--format', '{{.Id}}', image],
        IMAGE_INSPECT_TIMEOUT_MS,
      )

      return true
    } catch (error) {
      if (isImageAbsent(ensureError(error).message)) return false
      throw new ContainerRuntimeUnavailableError(ensureError(error).message)
    }
  }

  private async resolveImage(image: string): Promise<string> {
    if (isImmutableImageReference(image)) return image

    let inspected: ExecResult
    try {
      inspected = await this.docker(['image', 'inspect', image], IMAGE_INSPECT_TIMEOUT_MS)
    } catch (error) {
      const detail = ensureError(error).message
      // The distinction `resolvesImage` makes, made here for the same reason and
      // in the same place: what docker's wording means is docker's to read.
      if (!isImageAbsent(detail)) throw new ContainerRuntimeUnavailableError(detail)

      throw new Error(`could not pin runner image "${image}": ${detail}`)
    }

    try {
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

  /**
   * The client needs a socket and the names it forwards; nothing else. The
   * names come from the run being made rather than from the process, so a stage
   * under one provider never carries another's credential (AC-520).
   */
  private clientEnv(forwardEnv: readonly string[] = []): Record<string, string> {
    const env: Record<string, string> = { PATH: process.env.PATH ?? '/usr/bin:/bin' }
    if (process.env.DOCKER_HOST) env.DOCKER_HOST = process.env.DOCKER_HOST
    for (const name of forwardEnv) {
      const value = process.env[name]
      if (value !== undefined) env[name] = value
    }

    return env
  }
}

/**
 * `docker run` exits 125 when the client could not start the container, 126 when
 * the entrypoint is not executable and 127 when it is not there. None of them is
 * the provider's own exit code, because the provider has not run — which is what
 * the run is asked, and answered here rather than by the stage-run layer that
 * also serves a backend with no containers in it.
 */
const CLIENT_START_EXITS: ReadonlySet<number> = new Set([125, 126, 127])

/**
 * The exit code alone cannot answer it: `docker run` propagates the container's
 * status, and the entrypoint propagates the provider's, so a provider CLI that
 * shells out to something missing exits 127 through both. The marker is written
 * by the entrypoint before it can fail, so its presence is the container having
 * started — the one fact the numbering leaves ambiguous.
 */
const ENTRYPOINT_MARKER = 'specmate runner: entrypoint started'

export function withStartFailure(result: ExecResult): ExecResult {
  if (result.timedOut || !CLIENT_START_EXITS.has(result.exitCode)) return result
  if (result.stderr.includes(ENTRYPOINT_MARKER)) return result

  const reported = result.stderr.trim() || result.stdout.trim()

  return {
    ...result,
    startFailure: reported || `the container runtime exited ${result.exitCode}`,
  }
}

/**
 * The runtime answering that it does not have the image. Every other failure of
 * the same command is the runtime not answering — the distinction the caller
 * needs, and the only place docker's wording is read.
 */
const IMAGE_ABSENT = /no such image|no such object|manifest unknown|not found/i

function isImageAbsent(message: string): boolean {
  return IMAGE_ABSENT.test(message)
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
  // A cleanup caller (cleanupInterruptedAttempt) treats this resolving as proof
  // the target is dead. Swallowing a `docker ps`/`docker kill` failure into an
  // empty result would let it delete the workspace and mark cleanup succeeded
  // while the old attempt's container is still running — throwing instead
  // routes the caller into its own retry path.
  const found = await spawnBounded({
    argv: [config.dockerCli, 'ps', '--quiet', ...filters],
    stdin: '',
    cwd: process.cwd(),
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
    timeoutMs: 30_000,
    outputLimitBytes: 64 * 1024,
  })
  if (found.exitCode !== 0) {
    throw new Error(
      `docker ps failed listing containers to clean up: ${found.stderr || `exit ${found.exitCode}`}`,
    )
  }

  const ids = found.stdout
    .split('\n')
    .map((id) => id.trim())
    .filter((id) => id.length > 0)

  const killed: string[] = []
  const failures: string[] = []
  for (const id of ids) {
    const result = await spawnBounded({
      argv: [config.dockerCli, 'kill', id],
      stdin: '',
      cwd: process.cwd(),
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
      timeoutMs: 30_000,
      outputLimitBytes: 16 * 1024,
    }).catch((error: Error) => ({ exitCode: -1, stdout: '', stderr: error.message }))
    if (result.exitCode === 0) {
      killed.push(id)
    } else {
      failures.push(`${id}: ${result.stderr || `exit ${result.exitCode}`}`)
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `docker kill failed for ${failures.length} container(s): ${failures.join('; ')}`,
    )
  }

  return killed
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
