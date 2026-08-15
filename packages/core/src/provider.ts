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
