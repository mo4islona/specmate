import {
  type AgentProvider,
  type AgentRole,
  declaredChangeName,
  FAILURE_KINDS,
  type FailureReason,
  type ModelId,
  type ProviderId,
  type ReasoningEffort,
  ROLE_CONTRACTS,
  type SpecConvention,
  type StageActivity,
  type StageJob,
  type StageResult,
  type StageResumption,
  type StageTelemetry,
} from '@specmate/core'
import type { Git, Workspace, WorkspaceService } from '@specmate/workspace'
import { checkBriefCompleteness } from './brief.ts'
import type { RunnerConfig } from './config.ts'
import { corroborateVerification } from './corroboration.ts'
import { assemblePrompt } from './prompt.ts'
import { RUN_FAILURES, type StageRunError, stageLabel } from './provider-run.ts'
import type { StageRejection } from './rejection.ts'
import { changedPaths, changesRoot, checkWriteScope } from './scope.ts'

/** Injected rather than a database handle: the ledger is text by the time a stage sees it. */
export type LedgerSource = (taskId: string) => Promise<string>

/** One retry, then the stage fails — `agent-contracts`, structured result contract. */
const MAX_ATTEMPTS = 2

/** What a run can end as, plus what the executor's own checks can decline. */
export const STAGE_FAILURES = [
  ...RUN_FAILURES,
  'backend_unavailable',
  'scope_violation',
  'agent_failed',
  'uncorroborated',
  'uncheckable_verdict',
  'incomplete_brief',
] as const satisfies readonly FailureReason[]

export type StageFailure = (typeof STAGE_FAILURES)[number]

export interface StageRequest {
  readonly taskId: string
  readonly stageId: string
  /** Pipeline node key, when the loop dispatches; labels the container for the sweep. */
  readonly node?: string
  readonly role: AgentRole
  /** Provider the engine bound and recorded for this stage; one this process does not run is refused. */
  readonly provider: ProviderId
  /** Resolved from the task's stored model bindings for this stage's role. */
  readonly model: ModelId
  readonly reasoningEffort: ReasoningEffort
  readonly workspace: Workspace
  readonly baseBranch: string
  /** Immutable runner image and exact toolchains pinned for this task. */
  readonly environment: StageJob['environment']
  /** Attempt number of the first try; a retry records the next one. */
  readonly attempt?: number
  /**
   * Aborted when the owner's stop claims this stage (REQ-1607). Read between
   * attempts; terminating the attempt already running belongs to whoever owns
   * its container.
   */
  readonly signal?: AbortSignal
  /**
   * The earlier node this run continues by forking its session (REQ-410), or null
   * when it continues nothing. Required rather than optional: a caller that leaves
   * it out is a caller that forgot, and the stage would silently run cold.
   */
  readonly resume: StageResumption | null
  /** What the repository keeps its specification in, as provisioning last resolved it. */
  readonly specConvention?: SpecConvention | null
}

export interface StageAttemptRecord {
  readonly attempt: number
  readonly ok: boolean
  readonly failure?: StageFailure
  readonly detail?: string
  readonly durationMs: number
}

export interface StageExecution {
  readonly status: 'succeeded' | 'failed'
  readonly attempts: readonly StageAttemptRecord[]
  readonly result?: StageResult
  readonly failure?: StageFailure
  readonly detail?: string
  readonly commit?: string
  /** The orchestrator must commit while holding the task lock. */
  readonly commitDeferred?: boolean
  /** From the successful run's envelope; null when it could not be parsed. */
  readonly telemetry?: StageTelemetry | null
  /** The session this run left, for a later node to continue (REQ-214). */
  readonly sessionId?: string | null
  /** Set when a resumption was asked for and could not be had (AC-235). */
  readonly coldStartReason?: string | null
}

/**
 * What the attempt before this one left behind: why the harness rejected it, and
 * the session it ran under when that rejection was of complete work.
 */
interface PreviousAttempt {
  readonly rejection: StageRejection
  /** Null when the run itself failed — that reasoning is what the discard drops. */
  readonly sessionId: string | null
}

/** A recognized tool use, attributed to the stage attempt it came from. */
export interface StageActivityEvent extends StageActivity {
  readonly taskId: string
  readonly stageId: string
  readonly attempt: number
}

/** Every provider this process runs, keyed by id — what a job's provider selects from. */
export type ProviderRegistry = ReadonlyMap<ProviderId, AgentProvider>

export function providerRegistry(providers: readonly AgentProvider[]): ProviderRegistry {
  return new Map(providers.map((provider) => [provider.id, provider]))
}

export interface StageExecutorDeps {
  readonly config: RunnerConfig
  readonly providers: ProviderRegistry
  readonly git: Git
  readonly workspaces: WorkspaceService
  readonly ledger: LedgerSource
  /** Production orchestration owns the commit/stop race under its task lock. */
  readonly deferCommit?: boolean
  /** Durably records a running attempt's activity — the orchestrator's own event log. */
  readonly onActivity?: (event: StageActivityEvent) => void
}

/**
 * One stage, end to end: assemble, run, check, commit. The order is the point —
 * nothing reaches a commit that has not been parsed and scope-checked first, and
 * a retry starts from committed state rather than from what a failed attempt
 * left half-written.
 */
export class StageExecutor {
  constructor(private readonly deps: StageExecutorDeps) {}

  async execute(request: StageRequest): Promise<StageExecution> {
    // The binding is recorded on the stage row and in commit trailers; quietly
    // running a different provider would make that attribution lie, so a stage
    // bound to a provider this deployment does not run fails saying so (AC-242).
    const provider = this.deps.providers.get(request.provider)
    if (!provider) {
      return {
        status: 'failed',
        attempts: [],
        failure: 'provider_error',
        detail: `stage is bound to provider "${request.provider}", which this deployment does not run`,
      }
    }

    const attempts: StageAttemptRecord[] = []
    const first = request.attempt ?? 0
    // A retry given the same prompt that produced the failure has nothing to go
    // on, and one given no session starts from nothing (REQ-209, REQ-217).
    let previous: PreviousAttempt | undefined

    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      const attempt = first + i
      const outcome = await this.attempt(request, attempt, provider, previous)
      attempts.push(outcome.record)
      if (outcome.record.ok) {
        return {
          status: 'succeeded',
          attempts,
          result: outcome.result,
          sessionId: outcome.sessionId ?? null,
          coldStartReason: outcome.coldStartReason ?? null,
          commit: outcome.commit,
          commitDeferred: outcome.commitDeferred,
          telemetry: outcome.telemetry ?? null,
        }
      }

      if (outcome.record.failure) {
        // A rejection of complete work is a correction to that work: the session
        // that produced it is sound, and continuing it is handing the work back
        // rather than re-reading failed reasoning (REQ-209, AC-244, AC-245).
        const declined = FAILURE_KINDS[outcome.record.failure].producedResult

        previous = {
          rejection: {
            attempt,
            reason: outcome.record.failure,
            detail: outcome.record.detail ?? null,
            workspaceReset: false,
          },
          sessionId: declined ? (outcome.sessionId ?? null) : null,
        }
      }

      // The second run would be the first run: same image, same host, same
      // missing manifest. The cap is for a check and an agent that disagree.
      if (outcome.record.failure && !FAILURE_KINDS[outcome.record.failure].retryable) break

      // The stop already ended this stage: another attempt would put an agent back
      // on a workspace the orchestrator is in the middle of discarding.
      if (request.signal?.aborted) break

      // Only before another try: a stage that has run out of attempts leaves its
      // working tree as it was, which is what a human will be asked to look at.
      if (i < MAX_ATTEMPTS - 1) {
        await this.deps.workspaces.discard(request.workspace)
        // The continued session's transcript says it wrote those files; after
        // this they are gone. An attempt that is not told so writes only the
        // correction and leaves the change folder half-built.
        if (previous) {
          previous = {
            ...previous,
            rejection: { ...previous.rejection, workspaceReset: true },
          }
        }
      }
    }

    const last = attempts.at(-1)

    return {
      status: 'failed',
      attempts,
      failure: last?.failure,
      detail: last?.detail,
    }
  }

  private async attempt(
    request: StageRequest,
    attempt: number,
    provider: AgentProvider,
    previous?: PreviousAttempt,
  ): Promise<{
    record: StageAttemptRecord
    result?: StageResult
    commit?: string
    commitDeferred?: boolean
    telemetry?: StageTelemetry | null
    sessionId?: string | null
    coldStartReason?: string | null
  }> {
    const { config, git, workspaces, ledger: loadLedger, onActivity } = this.deps
    const ledger = await loadLedger(request.taskId)
    const prompt = await assemblePrompt(git, config, {
      role: request.role,
      workspace: request.workspace,
      baseBranch: request.baseBranch,
      ledger,
      rejection: previous?.rejection,
    })

    const job: StageJob = {
      taskId: request.taskId,
      stageId: request.stageId,
      node: request.node,
      role: request.role,
      provider: provider.id,
      model: request.model,
      reasoningEffort: request.reasoningEffort,
      workspacePath: request.workspace.path,
      changeDir: request.workspace.changeDir,
      prompt,
      needsContainerRuntime: roleNeedsContainerRuntime(request.role),
      environment: request.environment,
      timeoutMs: config.stageTimeoutMs,
      attempt,
      resume: request.resume,
      continueSession: previous?.sessionId ?? null,
      onActivity: onActivity
        ? (activity) =>
            onActivity({ ...activity, taskId: request.taskId, stageId: request.stageId, attempt })
        : undefined,
    }

    let outcome: Awaited<ReturnType<AgentProvider['run']>>
    try {
      outcome = await provider.run(job)
    } catch (e) {
      const error = e as StageRunError

      return {
        record: {
          attempt,
          ok: false,
          failure: error.failure ?? 'provider_error',
          detail: error.message,
          durationMs: error.durationMs ?? 0,
        },
      }
    }

    // Memoized: `checkWriteScope` and `checkBriefCompleteness` both read the
    // workspace's changed paths, and a stage attempt never mutates the tree
    // between them, so the underlying `git status` runs at most once here.
    let changedPathsPromise: Promise<string[]> | undefined
    const getChangedPaths = () => (changedPathsPromise ??= changedPaths(git, request.workspace))

    const violations = await checkWriteScope(
      request.workspace,
      request.role,
      getChangedPaths,
      await this.ownDeclaredChange(
        request.workspace,
        declaredChangeName(request.role, outcome.result),
      ),
    )
    if (violations.length > 0) {
      return {
        record: {
          attempt,
          ok: false,
          failure: 'scope_violation',
          detail: `role ${request.role} may not modify product code but changed: ${violations.join(', ')}`,
          durationMs: outcome.durationMs,
        },
        sessionId: outcome.sessionId,
      }
    }

    // An honest failure report keeps its artifacts out of the task branch: the
    // retry must start from the last good commit, and `discard` can only take
    // the tree back there if the failed run was never committed.
    if (outcome.result.status === 'failed') {
      return {
        record: {
          attempt,
          ok: false,
          failure: 'agent_failed',
          detail: outcome.result.notes_md || 'the agent reported failure in RESULT.json',
          durationMs: outcome.durationMs,
        },
        sessionId: outcome.sessionId,
      }
    }

    // Same posture as the write-scope check: after the run, before the outcome
    // is accepted and anything is committed. A no-op for a role the catalog
    // does not declare, and for a run that left the proposal untouched.
    //
    // The coverage comes from this attempt's own result, not the task's
    // stored value: for `planning`, the stored value is still whatever an
    // earlier attempt left (`unknown` on a fresh task) — this run is what
    // determines it. `kickoff_brief` doesn't re-probe, so its own result
    // carries the same classification the stored value already holds either
    // way (§1401), and a role the catalog does not mark `probesHarness`
    // carries none — `checkBrief` treats that as `adequate`, its default.
    const brief = await checkBriefCompleteness(
      config,
      request.workspace,
      request.role,
      getChangedPaths,
      outcome.result.harness_coverage?.classification,
      request.specConvention ?? null,
    )
    if (brief.kind === 'incomplete') {
      return {
        record: {
          attempt,
          ok: false,
          failure: 'incomplete_brief',
          detail: brief.detail,
          durationMs: outcome.durationMs,
        },
        sessionId: outcome.sessionId,
      }
    }

    // Same posture as the write-scope check: after the run, before the outcome
    // is accepted and anything is committed. A no-op for a role the catalog
    // does not declare corroborated.
    const corroboration = await corroborateVerification(
      request.workspace,
      outcome.result,
      request.specConvention ?? null,
    )
    if (corroboration.kind === 'uncorroborated') {
      return {
        record: {
          attempt,
          ok: false,
          failure: 'uncorroborated',
          detail: `approve is not corroborated by the report for: ${corroboration.violations.join(', ')}`,
          durationMs: outcome.durationMs,
        },
        sessionId: outcome.sessionId,
      }
    }
    // Not `invalid_result`: the result parsed, and cleared scope, self-report and
    // brief before reaching here. What could not be read is the verdict's own
    // evidence, and the reasoning that produced the result is worth handing back.
    if (corroboration.kind === 'invalid') {
      return {
        record: {
          attempt,
          ok: false,
          failure: 'uncheckable_verdict',
          detail: corroboration.detail,
          durationMs: outcome.durationMs,
        },
        sessionId: outcome.sessionId,
      }
    }

    const result =
      corroboration.kind === 'ok'
        ? { ...outcome.result, findings: [...corroboration.findings] }
        : outcome.result

    const commit = this.deps.deferCommit
      ? null
      : await workspaces.commitStage(request.taskId, request.workspace, {
          stageId: request.stageId,
          role: request.role,
          provider: provider.id,
          attempt,
        })

    return {
      record: { attempt, ok: true, durationMs: outcome.durationMs },
      result,
      commit: commit?.committed ? commit.commit : undefined,
      commitDeferred: this.deps.deferCommit,
      telemetry: outcome.telemetry,
      sessionId: outcome.sessionId,
      coldStartReason: outcome.coldStartReason,
    }
  }

  /**
   * The declared name only where it is this task's folder to write into. A name
   * the repository already keeps a change under is another change's: convergence
   * suffixes this task's folder away from it (AC-742), so anything written there
   * would be committed into work that is not this task's.
   */
  private async ownDeclaredChange(
    workspace: Workspace,
    declared: string | null,
  ): Promise<string | null> {
    if (!declared) return null

    const folder = `${changesRoot(workspace.changeDir)}/${declared}`
    const tracked = await this.deps.git.tryRun(['ls-files', '--', folder], { cwd: workspace.path })

    return tracked.exitCode === 0 && tracked.stdout.trim().length > 0 ? null : declared
  }
}

export { stageLabel }

export function roleNeedsContainerRuntime(role: AgentRole): boolean {
  return ROLE_CONTRACTS[role].writesCode
}
