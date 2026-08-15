import type { StageResult } from './result.ts'
import type { AgentRole, ProviderId } from './roles.ts'

export interface StageJob {
  readonly taskId: string
  readonly stageId: string
  readonly role: AgentRole
  readonly provider: ProviderId
  /** Absolute path of the worktree the stage runs in. */
  readonly workspacePath: string
  /** Change folder relative to the workspace, e.g. openspec/changes/<slug>. */
  readonly changeDir: string
  /** Fully assembled prompt: role prompt + artifacts + ledger + optional spec skill. */
  readonly prompt: string
  /** SHA of the house spec-standard skill copy injected, when any (§11). */
  readonly skillSha?: string
  /**
   * Whether this role needs to start containers of its own — a repository's own
   * harness, typically. Off by default: a stage that has not asked for a
   * container runtime cannot reach one.
   */
  readonly needsContainerRuntime?: boolean
  /**
   * Runner image for this stage. The provider CLI is ours; the toolchain that
   * builds and tests the target repository is the repository's, so the image is
   * a per-task choice rather than one global default.
   */
  readonly image?: string
  readonly timeoutMs: number
  readonly attempt: number
}

export interface StageOutcome {
  readonly result: StageResult
  /** Raw CLI stdout/stderr, persisted for the UI log view. */
  readonly log: string
  readonly exitCode: number
  readonly durationMs: number
}

export type ProviderAuthState = 'ok' | 'expired' | 'unknown'

export interface ProviderStatus {
  readonly provider: ProviderId
  readonly auth: ProviderAuthState
  readonly cliVersion?: string
  readonly detail?: string
}

/**
 * The only surface the orchestrator sees. Every provider is an official
 * headless CLI invoked inside its runner container (§9.2) — no OAuth bridging.
 */
export interface AgentProvider {
  readonly id: ProviderId
  run(job: StageJob): Promise<StageOutcome>
  healthcheck(): Promise<ProviderStatus>
}
