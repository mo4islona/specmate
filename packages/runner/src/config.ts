import { resolve } from 'node:path'
import { DEFAULT_BRIEF_CEILING_BYTES, type ProviderId } from '@specmate/core'

export type BackendId = 'docker' | 'local'

/**
 * What one provider needs to run a stage. Per provider rather than per process
 * because a stage reaches the credential of the provider it runs under and no
 * other (REQ-203, REQ-508): one shared home and one shared forward list would
 * put every provider's credential inside every stage.
 */
export interface ProviderRuntime {
  /** Provider CLI, as invoked inside the image and on a developer's PATH. */
  readonly cli: string
  /** Named volume carrying this provider's session; mounted read-write, it refreshes itself. */
  readonly authVolume: string
  /**
   * Variable names forwarded from the orchestrator's environment into a stage
   * running under this provider — how billing moves from the stored session to
   * an API key without a code change. Values are never placed on the command line.
   */
  readonly forwardEnv: readonly string[]
}

export type ProviderRuntimes = Readonly<Partial<Record<ProviderId, ProviderRuntime>>>

export interface RunnerConfig {
  /** Where a stage's process runs. `local` is for development only. */
  readonly backend: BackendId
  /** Default runner image; provisioning records the task's immutable reference. */
  readonly image: string
  /** Container runtime client. A knob because podman and remote hosts exist. */
  readonly dockerCli: string
  /** Exactly the providers this deployment runs — what provider binding selects from. */
  readonly providers: ProviderRuntimes
  /** Directory holding `<role>.md`, read by the orchestrator, not the runner. */
  readonly rolesDir: string
  /** Shared named volume carrying mise installs across stages and tasks. */
  readonly toolchainsVolume: string
  /** HOME inside the container — where the provider CLI keeps that session. */
  readonly homeDir: string
  /** uid:gid inside the container; matches the image's unprivileged user. */
  readonly user: string
  /** Wall clock one attempt gets, counted from spawn — activity does not extend it. */
  readonly stageTimeoutMs: number
  readonly cpus: string
  readonly memory: string
  /**
   * Where the in-process backend records agent pids, so the restart sweep can
   * kill what a dead orchestrator left running. Absent disables tracking —
   * containers carry labels instead, and tests need neither.
   */
  readonly pidDir?: string
  /** Caps, each with an explicit truncation notice rather than a silent cut. */
  readonly diffBytesLimit: number
  readonly ledgerBytesLimit: number
  readonly artifactBytesLimit: number
  readonly logBytesLimit: number
  /** REQ-1302: the kickoff brief stays one page. */
  readonly briefBytesLimit: number
}

/** Shipped names for a provider's CLI and volume, before configuration narrows them. */
export const DEFAULT_PROVIDER_RUNTIMES = {
  'claude-code': { cli: 'claude', authVolume: 'specmate_claude-auth', forwardEnv: [] },
  codex: { cli: 'codex', authVolume: 'specmate_codex-auth', forwardEnv: [] },
} as const satisfies ProviderRuntimes

export const DEFAULT_RUNNER_CONFIG = {
  backend: 'local',
  image: 'specmate/runner-universal:latest',
  dockerCli: 'docker',
  // One provider unless configuration says otherwise: a deployment that has not
  // said it runs a second one must not have stages bound to it.
  providers: { 'claude-code': DEFAULT_PROVIDER_RUNTIMES['claude-code'] },
  rolesDir: 'roles',
  toolchainsVolume: 'specmate_toolchains',
  homeDir: '/home/agent',
  user: '10001:10001',
  stageTimeoutMs: 3 * 60 * 60_000,
  cpus: '2',
  memory: '4g',
  diffBytesLimit: 256 * 1024,
  ledgerBytesLimit: 32 * 1024,
  artifactBytesLimit: 256 * 1024,
  logBytesLimit: 4 * 1024 * 1024,
  briefBytesLimit: DEFAULT_BRIEF_CEILING_BYTES,
} as const satisfies RunnerConfig

export type RunnerOptions = Partial<RunnerConfig>

export function resolveRunnerConfig(options: RunnerOptions = {}): RunnerConfig {
  const defined = Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined))
  const merged = { ...DEFAULT_RUNNER_CONFIG, ...defined } as RunnerConfig
  if (merged.stageTimeoutMs <= 0) throw new Error('stageTimeoutMs must be positive')
  if (Object.keys(merged.providers).length === 0) {
    throw new Error('at least one provider must be configured')
  }

  return {
    ...merged,
    rolesDir: resolve(merged.rolesDir),
    ...(merged.pidDir ? { pidDir: resolve(merged.pidDir) } : {}),
  }
}

/** The configured providers, in the order configuration named them. */
export function configuredProviders(config: RunnerConfig): ProviderId[] {
  return Object.keys(config.providers) as ProviderId[]
}

export function providerRuntime(config: RunnerConfig, provider: ProviderId): ProviderRuntime {
  const runtime = config.providers[provider]
  if (!runtime) throw new Error(`provider "${provider}" is not configured`)

  return runtime
}
