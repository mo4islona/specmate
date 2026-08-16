import type { ExecutionEnvironment } from './environment.ts'
import type { StageResult } from './result.ts'
import type { AgentRole, ProviderId } from './roles.ts'

export interface StageJob {
  readonly taskId: string
  readonly stageId: string
  /** Pipeline node key this run serves; labels the container for the restart sweep. */
  readonly node?: string
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
   * Whether this role may start containers for the repository's own harness.
   * The executor derives it from the fixed role contract; callers cannot grant it.
   */
  readonly needsContainerRuntime?: boolean
  /** Immutable runner image and exact toolchains pinned when the task was provisioned. */
  readonly environment: ExecutionEnvironment
  readonly timeoutMs: number
  readonly attempt: number
}

/**
 * What actually ran, as the provider reported it — not what was configured.
 * Absent is null, never zero: the debug chart must tell "no data" from "free".
 */
export interface StageTelemetry {
  /** The model that served the run; a provider-side substitution shows here. */
  readonly model: string | null
  /** Token counts under the provider's own keys. */
  readonly tokens: Readonly<Record<string, number>> | null
  readonly costUsd: number | null
  /** The raw envelope, kept for whatever the normalization did not anticipate. */
  readonly raw: unknown
}

export interface StageOutcome {
  readonly result: StageResult
  /** Raw CLI stdout/stderr, persisted for the UI log view. */
  readonly log: string
  readonly exitCode: number
  readonly durationMs: number
  /** Best-effort: null when the provider's envelope could not be parsed. */
  readonly telemetry?: StageTelemetry | null
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
