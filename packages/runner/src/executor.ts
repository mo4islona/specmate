import {
  type AgentProvider,
  type AgentRole,
  type ProviderId,
  ROLE_CONTRACTS,
  type StageJob,
  type StageResult,
  type StageTelemetry,
} from '@specmate/core'
import type { Git, Workspace, WorkspaceService } from '@specmate/workspace'
import { checkBriefCompleteness } from './brief.ts'
import { type RunFailure, type StageRunError, stageLabel } from './claude.ts'
import type { RunnerConfig } from './config.ts'
import { corroborateVerification } from './corroboration.ts'
import { assemblePrompt } from './prompt.ts'
import { changedPaths, checkWriteScope } from './scope.ts'

/** Injected rather than a database handle: the ledger is text by the time a stage sees it. */
export type LedgerSource = (taskId: string) => Promise<string>

/** One retry, then the stage fails — `agent-contracts`, structured result contract. */
const MAX_ATTEMPTS = 2

export type StageFailure =
  | RunFailure
  | 'scope_violation'
  | 'agent_failed'
  | 'uncorroborated'
  | 'incomplete_brief'

export interface StageRequest {
  readonly taskId: string
  readonly stageId: string
  /** Pipeline node key, when the loop dispatches; labels the container for the sweep. */
  readonly node?: string
  readonly role: AgentRole
  /** Provider the engine bound and recorded for this stage; a mismatch is refused. */
  readonly provider?: ProviderId
  readonly workspace: Workspace
  readonly baseBranch: string
  /** Immutable runner image and exact toolchains pinned for this task. */
  readonly environment: StageJob['environment']
  /** Attempt number of the first try; a retry records the next one. */
  readonly attempt?: number
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
}

export interface StageExecutorDeps {
  readonly config: RunnerConfig
  readonly provider: AgentProvider
  readonly git: Git
  readonly workspaces: WorkspaceService
  readonly ledger: LedgerSource
  /** Production orchestration owns the commit/stop race under its task lock. */
  readonly deferCommit?: boolean
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
    // running a different provider would make that attribution lie.
    if (request.provider && request.provider !== this.deps.provider.id) {
      return {
        status: 'failed',
        attempts: [],
        failure: 'provider_error',
        detail: `stage is bound to provider "${request.provider}" but this executor runs "${this.deps.provider.id}"`,
      }
    }

    const attempts: StageAttemptRecord[] = []
    const first = request.attempt ?? 0

    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      const attempt = first + i
      const outcome = await this.attempt(request, attempt)
      attempts.push(outcome.record)
      if (outcome.record.ok) {
        return {
          status: 'succeeded',
          attempts,
          result: outcome.result,
          commit: outcome.commit,
          commitDeferred: outcome.commitDeferred,
          telemetry: outcome.telemetry ?? null,
        }
      }

      // Only before another try: a stage that has run out of attempts leaves its
      // working tree as it was, which is what a human will be asked to look at.
      if (i < MAX_ATTEMPTS - 1) await this.deps.workspaces.discard(request.workspace)
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
  ): Promise<{
    record: StageAttemptRecord
    result?: StageResult
    commit?: string
    commitDeferred?: boolean
    telemetry?: StageTelemetry | null
  }> {
    const { config, provider, git, workspaces, ledger: loadLedger } = this.deps
    const ledger = await loadLedger(request.taskId)
    const prompt = await assemblePrompt(git, config, {
      role: request.role,
      workspace: request.workspace,
      baseBranch: request.baseBranch,
      ledger,
    })

    const job: StageJob = {
      taskId: request.taskId,
      stageId: request.stageId,
      node: request.node,
      role: request.role,
      provider: provider.id,
      workspacePath: request.workspace.path,
      changeDir: request.workspace.changeDir,
      prompt,
      needsContainerRuntime: roleNeedsContainerRuntime(request.role),
      environment: request.environment,
      timeoutMs: config.stageTimeoutMs,
      attempt,
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

    const violations = await checkWriteScope(request.workspace, request.role, getChangedPaths)
    if (violations.length > 0) {
      return {
        record: {
          attempt,
          ok: false,
          failure: 'scope_violation',
          detail: `role ${request.role} may not modify product code but changed: ${violations.join(', ')}`,
          durationMs: outcome.durationMs,
        },
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
      }
    }

    // Same posture as the write-scope check: after the run, before the outcome
    // is accepted and anything is committed. A no-op for a role the catalog
    // does not declare, and for a run that left the proposal untouched.
    const brief = await checkBriefCompleteness(
      config,
      request.workspace,
      request.role,
      getChangedPaths,
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
      }
    }

    // Same posture as the write-scope check: after the run, before the outcome
    // is accepted and anything is committed. A no-op for a role the catalog
    // does not declare corroborated.
    const corroboration = await corroborateVerification(request.workspace, outcome.result)
    if (corroboration.kind === 'uncorroborated') {
      return {
        record: {
          attempt,
          ok: false,
          failure: 'uncorroborated',
          detail: `approve is not corroborated by the report for: ${corroboration.violations.join(', ')}`,
          durationMs: outcome.durationMs,
        },
      }
    }
    if (corroboration.kind === 'invalid') {
      return {
        record: {
          attempt,
          ok: false,
          failure: 'invalid_result',
          detail: corroboration.detail,
          durationMs: outcome.durationMs,
        },
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
    }
  }
}

export { stageLabel }

export function roleNeedsContainerRuntime(role: AgentRole): boolean {
  return ROLE_CONTRACTS[role].writesCode
}
