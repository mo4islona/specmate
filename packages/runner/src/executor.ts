import type { AgentProvider, AgentRole, StageJob, StageResult } from '@specmate/core'
import type { Git, Workspace, WorkspaceService } from '@specmate/workspace'
import { type RunFailure, type StageRunError, stageLabel } from './claude.ts'
import type { RunnerConfig } from './config.ts'
import { assemblePrompt } from './prompt.ts'
import { checkWriteScope } from './scope.ts'

/** Injected rather than a database handle: the ledger is text by the time a stage sees it. */
export type LedgerSource = (taskId: string) => Promise<string>

/** One retry, then the stage fails — `agent-contracts`, structured result contract. */
const MAX_ATTEMPTS = 2

export type StageFailure = RunFailure | 'scope_violation'

export interface StageRequest {
  readonly taskId: string
  readonly stageId: string
  readonly role: AgentRole
  readonly workspace: Workspace
  readonly baseBranch: string
  readonly needsContainerRuntime?: boolean
  /** Runner image for this task, when its toolchain is not the default one. */
  readonly image?: string
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
}

export interface StageExecutorDeps {
  readonly config: RunnerConfig
  readonly provider: AgentProvider
  readonly git: Git
  readonly workspaces: WorkspaceService
  readonly ledger: LedgerSource
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
      role: request.role,
      provider: provider.id,
      workspacePath: request.workspace.path,
      changeDir: request.workspace.changeDir,
      prompt,
      needsContainerRuntime: request.needsContainerRuntime ?? false,
      image: request.image,
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

    const violations = await checkWriteScope(git, request.workspace, request.role)
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

    const commit = await workspaces.commitStage(request.taskId, request.workspace, {
      stageId: request.stageId,
      role: request.role,
      provider: provider.id,
      attempt,
    })

    return {
      record: { attempt, ok: true, durationMs: outcome.durationMs },
      result: outcome.result,
      commit: commit.committed ? commit.commit : undefined,
    }
  }
}

export { stageLabel }
