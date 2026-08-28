import type { ExecutionEnvironment } from './environment.ts'
import type { ModelId, ReasoningEffort } from './models.ts'
import type { StageResult } from './result.ts'
import type { AgentRole, ProviderId } from './roles.ts'

/**
 * A run that continues an earlier node's session (REQ-410).
 *
 * The two facts are separate on purpose. `node` comes from the graph and is what
 * makes this run a continuation — it holds even when the provider hands back no
 * session and the run starts cold. `sessionId` is only what was actually
 * recorded, so it is what decides whether there is anything to fork.
 */
export interface StageResumption {
  /** Key of the node whose session this run continues. */
  readonly node: string
  /** The session to fork, or null when the resumed run recorded none. */
  readonly sessionId: string | null
}

export interface StageJob {
  readonly taskId: string
  readonly stageId: string
  /** Pipeline node key this run serves; labels the container for the restart sweep. */
  readonly node?: string
  readonly role: AgentRole
  readonly provider: ProviderId
  /** Resolved from the task's stored model bindings for this stage's role — never process config. */
  readonly model: ModelId
  /** Resolved from the same binding as `model`; passed to the CLI's `--effort` flag. */
  readonly reasoningEffort: ReasoningEffort
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
  /**
   * Set when the definition says this node continues an earlier one, null when it
   * does not. The run forks the session rather than appending to it, so a retry
   * starts from the same place this attempt did (AC-236).
   */
  readonly resume: StageResumption | null
  /**
   * The session of this stage's own previous attempt, set when the harness
   * declined that attempt's complete result for a named defect (REQ-209).
   *
   * Separate from `resume`, which is the graph's fact about what this node
   * continues and also excuses a run from re-declaring a plan. A retry declares
   * everything its first attempt owed; only the grounding is inherited.
   */
  readonly continueSession?: string | null
  /**
   * Fired for each recognized tool use while the run is still in progress.
   * Absent for callers (e.g. conversation turns) that don't surface activity.
   */
  readonly onActivity?: (activity: StageActivity) => void
}

/** One recognized tool use, parsed from a provider's own structured streaming output. */
export interface StageActivity {
  readonly tool: string
  readonly target: string
  /** Present when the use was an edit and the edit could be reconstructed (REQ-212). */
  readonly edit?: StageActivityEdit
}

/**
 * What one file-editing tool use did, as a unified diff. Two bounds because two
 * readers want different amounts: `preview` rides every timeline read, `patch`
 * is fetched for the one event being looked at.
 */
export interface StageActivityEdit {
  /** Relative to the working tree's root — never the absolute path the CLI reported. */
  readonly path: string
  readonly additions: number
  readonly deletions: number
  readonly preview: string
  readonly patch: string
  /** `preview` is the first part of `patch` rather than all of it. */
  readonly clamped: boolean
  /** The whole edit did not fit `patch`, which is therefore its first part. */
  readonly truncated: boolean
  /**
   * The diff's line numbers are the file's own. False when the file could not be
   * read to place the edit, which leaves the diff correct and its position unknown.
   */
  readonly anchored: boolean
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

/**
 * Durable usage for one agent attempt. Stage rows keep their timestamps in
 * columns; non-stage runs can carry them inline without inventing a second
 * telemetry shape.
 */
export interface ExecutionUsage {
  readonly provider?: ProviderId | null
  readonly model?: string | null
  readonly startedAt?: string | null
  readonly finishedAt?: string | null
  readonly durationMs?: number | null
  readonly tokens?: Readonly<Record<string, number>> | null
  readonly costUsd?: number | null
  readonly raw?: unknown
  readonly contextPath?: 'stored' | 'cached' | 'reconstructed' | 'none'
  readonly failure?: { readonly reason: string; readonly detail?: string } | null
}

export interface StageOutcome {
  readonly result: StageResult
  /** Raw CLI stdout/stderr, persisted for the UI log view. */
  readonly log: string
  readonly exitCode: number
  readonly durationMs: number
  /** Best-effort: null when the provider's envelope could not be parsed. */
  readonly telemetry?: StageTelemetry | null
  /** The session this run left behind, for a later node to continue (REQ-214). */
  readonly sessionId?: string | null
  /**
   * Set when a resumption was asked for and could not be had. The stage still
   * counts (AC-235); this says the grounding was rebuilt from artifacts instead.
   */
  readonly coldStartReason?: string | null
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
