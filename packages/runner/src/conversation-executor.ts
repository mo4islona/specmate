import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type {
  ConversationActionOption,
  ConversationActionProposal,
  FailureReason,
  ModelId,
  ProviderId,
  ReasoningEffort,
  StageJob,
  StageResult,
  StageTelemetry,
} from '@specmate/core'
import { ConversationResult } from '@specmate/core'
import {
  CONVERSATION_FILE,
  type ConversationWorkspace,
  type Git,
  SCRATCH_DIR,
} from '@specmate/workspace'
import type { RunnerConfig } from './config.ts'
import type { LedgerSource, ProviderRegistry } from './executor.ts'
import { assemblePrompt } from './prompt.ts'
import { RUN_FAILURES, type StageRunError, stageLabel } from './provider-run.ts'
import { changedPaths, checkWriteScope } from './scope.ts'

/** What a run can end as, plus what a turn's own checks can decline. */
export const CONVERSATION_FAILURES = [
  ...RUN_FAILURES,
  'backend_unavailable',
  'agent_failed',
  'malformed_message',
  'cleanup_failed',
  'scope_violation',
] as const satisfies readonly FailureReason[]

export type ConversationFailure = (typeof CONVERSATION_FAILURES)[number]

export interface ConversationRequest {
  readonly taskId: string
  readonly conversationId: string
  readonly responseId: string
  readonly message: string
  readonly context: string
  readonly previousAnchorCommit: string | null
  readonly previousTaskState: string | null
  readonly currentAnchorCommit: string
  readonly currentTaskState: string
  readonly contextPath: 'stored' | 'cached' | 'reconstructed' | 'none'
  readonly actionOptions: readonly ConversationActionOption[]
  readonly provider: ProviderId
  /** Resolved from the task's stored model bindings for the `answerer` role. */
  readonly model: ModelId
  readonly reasoningEffort: ReasoningEffort
  readonly workspace: ConversationWorkspace
  readonly baseBranch: string
  readonly environment: StageJob['environment']
  readonly attempt: number
}

export interface ConversationExecution {
  readonly status: 'succeeded' | 'failed'
  readonly message?: string
  readonly actions?: readonly ConversationActionProposal[]
  readonly providerSession?: Record<string, unknown> | null
  readonly result?: StageResult
  readonly failure?: ConversationFailure
  readonly detail?: string
  readonly durationMs: number
  readonly telemetry?: StageTelemetry | null
}

export interface ConversationExecutorDeps {
  readonly config: RunnerConfig
  readonly providers: ProviderRegistry
  readonly git: Git
  readonly ledger: LedgerSource
}

/** One read-only conversational turn. Durable retry policy belongs to the orchestrator. */
export class ConversationExecutor {
  constructor(private readonly deps: ConversationExecutorDeps) {}

  async execute(request: ConversationRequest): Promise<ConversationExecution> {
    const { config, git, ledger: loadLedger } = this.deps
    const provider = this.deps.providers.get(request.provider)
    if (!provider) {
      return {
        status: 'failed',
        failure: 'provider_error',
        detail: `conversation is bound to provider "${request.provider}", which this deployment does not run`,
        durationMs: 0,
      }
    }

    const jobLabel = `${request.responseId}-${request.attempt}`
    const resultPath = join(SCRATCH_DIR, jobLabel, CONVERSATION_FILE)
    const prompt = await assemblePrompt(git, config, {
      role: 'answerer',
      workspace: request.workspace,
      baseBranch: request.baseBranch,
      ledger: await loadLedger(request.taskId),
      conversation: {
        context: request.context,
        message: request.message,
        resultPath,
        previousAnchorCommit: request.previousAnchorCommit,
        previousTaskState: request.previousTaskState,
        currentAnchorCommit: request.currentAnchorCommit,
        currentTaskState: request.currentTaskState,
        contextPath: request.contextPath,
        actionOptions: request.actionOptions,
      },
    })
    const job: StageJob = {
      taskId: request.taskId,
      stageId: request.responseId,
      node: 'conversation',
      role: 'answerer',
      // A turn answers over the tree as it stands; it continues no stage's session.
      resume: null,
      provider: provider.id,
      model: request.model,
      reasoningEffort: request.reasoningEffort,
      workspacePath: request.workspace.path,
      changeDir: request.workspace.changeDir,
      prompt,
      needsContainerRuntime: false,
      environment: request.environment,
      timeoutMs: config.stageTimeoutMs,
      attempt: request.attempt,
    }
    if (stageLabel(job) !== jobLabel) throw new Error('conversation scratch label is inconsistent')

    try {
      const outcome = await provider.run(job)

      // Same posture as StageExecutor: the answerer is read-only by contract,
      // and the filesystem is checked regardless of what the agent reports.
      const violations = await checkWriteScope(request.workspace, 'answerer', () =>
        changedPaths(git, request.workspace),
      )
      if (violations.length > 0) {
        return {
          status: 'failed',
          result: outcome.result,
          failure: 'scope_violation',
          detail: `answerer may not modify product code but changed: ${violations.join(', ')}`,
          durationMs: outcome.durationMs,
          telemetry: outcome.telemetry ?? null,
        }
      }

      if (outcome.result.status !== 'ok') {
        return {
          status: 'failed',
          result: outcome.result,
          failure: 'agent_failed',
          detail: outcome.result.notes_md || `answerer returned ${outcome.result.status}`,
          durationMs: outcome.durationMs,
          telemetry: outcome.telemetry ?? null,
        }
      }

      const raw = await readFile(join(request.workspace.path, resultPath), 'utf8').catch(() => null)
      const parsed = raw === null ? null : ConversationResult.safeParse(safeJson(raw))
      if (!parsed?.success) {
        return {
          status: 'failed',
          result: outcome.result,
          failure: 'malformed_message',
          detail:
            raw === null ? `${CONVERSATION_FILE} is missing` : 'conversation result is invalid',
          durationMs: outcome.durationMs,
          telemetry: outcome.telemetry ?? null,
        }
      }

      const actionDefect = conversationActionDefect(parsed.data.actions, request.actionOptions)
      if (actionDefect) {
        return {
          status: 'failed',
          result: outcome.result,
          failure: 'malformed_message',
          detail: actionDefect,
          durationMs: outcome.durationMs,
          telemetry: outcome.telemetry ?? null,
        }
      }

      return {
        status: 'succeeded',
        message: parsed.data.message_md,
        actions: parsed.data.actions,
        providerSession: parsed.data.provider_session,
        result: outcome.result,
        durationMs: outcome.durationMs,
        telemetry: outcome.telemetry ?? null,
      }
    } catch (error) {
      const failure = error as StageRunError

      return {
        status: 'failed',
        failure: failure.failure ?? 'provider_error',
        detail: failure.message,
        durationMs: failure.durationMs ?? 0,
      }
    }
  }
}

function conversationActionDefect(
  actions: readonly ConversationActionProposal[],
  options: readonly ConversationActionOption[],
): string | null {
  for (const action of actions) {
    const option = options.find(
      (candidate) =>
        candidate.kind === action.kind &&
        isDeepStrictEqual(candidate.target, action.target) &&
        isDeepStrictEqual(candidate.expectedVersion, action.expectedVersion),
    )
    if (!option) {
      return `action ${action.kind} does not match an available action skeleton`
    }
    if (option.instruction === 'required' && !action.instruction) {
      return `action ${action.kind} requires an instruction`
    }
    if (option.instruction === 'omit' && action.instruction !== undefined) {
      return `action ${action.kind} must omit its instruction`
    }
  }

  return null
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}
