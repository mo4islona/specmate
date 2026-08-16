import { resolve } from 'node:path'

export type BackendId = 'docker' | 'local'

export interface RunnerConfig {
  /** Where a stage's process runs. `local` is for development only. */
  readonly backend: BackendId
  /** Default runner image; provisioning records the task's immutable reference. */
  readonly image: string
  /** Provider CLI, as invoked inside the image and on a developer's PATH. */
  readonly cli: string
  /** Container runtime client. A knob because podman and remote hosts exist. */
  readonly dockerCli: string
  readonly model: string
  /** Directory holding `<role>.md`, read by the orchestrator, not the runner. */
  readonly rolesDir: string
  /** Named volume carrying the provider session; mounted read-write, it refreshes itself. */
  readonly authVolume: string
  /** Shared named volume carrying mise installs across stages and tasks. */
  readonly toolchainsVolume: string
  /** HOME inside the container — where the provider CLI keeps that session. */
  readonly homeDir: string
  /** uid:gid inside the container; matches the image's unprivileged user. */
  readonly user: string
  /**
   * Variable names forwarded from the orchestrator's environment into the
   * stage — how billing moves from the stored session to an API key without a
   * code change. Values are never placed on the command line.
   */
  readonly forwardEnv: readonly string[]
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
}

export const DEFAULT_RUNNER_CONFIG = {
  backend: 'local',
  image: 'specmate/runner-universal:latest',
  cli: 'claude',
  dockerCli: 'docker',
  model: 'claude-opus-5',
  rolesDir: 'roles',
  authVolume: 'specmate_claude-auth',
  toolchainsVolume: 'specmate_toolchains',
  homeDir: '/home/agent',
  user: '10001:10001',
  forwardEnv: [],
  stageTimeoutMs: 30 * 60_000,
  cpus: '2',
  memory: '4g',
  diffBytesLimit: 256 * 1024,
  ledgerBytesLimit: 32 * 1024,
  artifactBytesLimit: 256 * 1024,
  logBytesLimit: 4 * 1024 * 1024,
} as const satisfies RunnerConfig

export type RunnerOptions = Partial<RunnerConfig>

export function resolveRunnerConfig(options: RunnerOptions = {}): RunnerConfig {
  const defined = Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined))
  const merged = { ...DEFAULT_RUNNER_CONFIG, ...defined } as RunnerConfig
  if (merged.stageTimeoutMs <= 0) throw new Error('stageTimeoutMs must be positive')

  return {
    ...merged,
    rolesDir: resolve(merged.rolesDir),
    ...(merged.pidDir ? { pidDir: resolve(merged.pidDir) } : {}),
  }
}
