import { type ExecutionEnvironment, stageModel } from '@specmate/core'
import type { ConversationExecutor, StageExecutor } from '@specmate/runner'
import type { ConversationDispatcher, StageDispatcher } from './engine.ts'
import {
  EnvironmentUnavailableError,
  EnvironmentUnresolvableError,
  type StageEnvironment,
} from './environment.ts'

export interface StageDispatcherDeps {
  readonly executor: StageExecutor
  /**
   * The pin the stage runs on, read moments after the tick took its task
   * snapshot and verified against the host that must honour it. Injected rather
   * than resolved here so what the dispatcher does to a dispatch is a mapping
   * and one named failure.
   */
  readonly stageEnvironment: StageEnvironment
}

/**
 * The one place a dispatch becomes a run request. It lives here rather than in the
 * entry point because the entry point is a script: nothing can call it, so every
 * test that needed a dispatcher wrote its own, and a field the real one dropped
 * was a field no test could miss.
 */
export function createStageDispatcher({
  executor,
  stageEnvironment,
}: StageDispatcherDeps): StageDispatcher {
  return async ({ task, node, stageId, attempt, provider, workspace, resume, signal }) => {
    const binding = task.modelBindings[node.role]

    let environment: ExecutionEnvironment
    try {
      environment = await stageEnvironment(task.id, workspace)
    } catch (error) {
      // No container was asked for, and asking again would ask for the same one:
      // the image is missing on the host that would have to run it (AC-818).
      if (error instanceof EnvironmentUnresolvableError) {
        return { status: 'failed', attempts: [], failure: 'backend_error', detail: error.message }
      }
      // Asking again is exactly what is worth doing here: nothing was
      // established, and the runtime may well answer on the next tick.
      if (error instanceof EnvironmentUnavailableError) {
        return {
          status: 'failed',
          attempts: [],
          failure: 'backend_unavailable',
          detail: error.message,
        }
      }

      throw error
    }

    return executor.execute({
      taskId: task.id,
      stageId,
      node: node.key,
      role: node.role,
      provider,
      // The provider was decided first and the model follows it: a checking node
      // runs under a provider chosen to differ from the writer's, and the
      // binding's model then belongs to the other one's CLI (REQ-112, AC-138).
      model: stageModel(binding, provider),
      reasoningEffort: binding.reasoningEffort,
      workspace,
      baseBranch: workspace.baseBranch,
      environment,
      attempt,
      resume,
      signal,
      specConvention: task.specConvention,
    })
  }
}

export interface ConversationDispatcherDeps {
  readonly executor: ConversationExecutor
  /**
   * The same verified pin a stage runs on. A conversation reaching for the
   * stored one would run every turn of a task whose image went missing against
   * a container that cannot start, until the cap — and stages self-healing
   * around it is what makes that invisible.
   */
  readonly stageEnvironment: StageEnvironment
}

/** The same edge for a conversation turn, testable for the same reason. */
export function createConversationDispatcher({
  executor,
  stageEnvironment,
}: ConversationDispatcherDeps): ConversationDispatcher {
  return async ({
    task,
    conversationId,
    response,
    ownerMessage,
    context,
    previousAnchorCommit,
    previousTaskState,
    currentAnchorCommit,
    currentTaskState,
    contextPath,
    actionOptions,
    attempt,
    provider,
    workspace,
  }) => {
    const binding = task.modelBindings.answerer

    let environment: ExecutionEnvironment
    try {
      environment = await stageEnvironment(task.id, workspace)
    } catch (error) {
      if (error instanceof EnvironmentUnresolvableError) {
        return { status: 'failed', failure: 'backend_error', detail: error.message, durationMs: 0 }
      }
      if (error instanceof EnvironmentUnavailableError) {
        return {
          status: 'failed',
          failure: 'backend_unavailable',
          detail: error.message,
          durationMs: 0,
        }
      }

      throw error
    }

    return executor.execute({
      taskId: task.id,
      conversationId,
      responseId: response.id,
      message: ownerMessage.contentMd,
      context,
      previousAnchorCommit,
      previousTaskState,
      currentAnchorCommit,
      currentTaskState,
      contextPath,
      actionOptions,
      provider,
      model: stageModel(binding, provider),
      reasoningEffort: binding.reasoningEffort,
      workspace,
      baseBranch: workspace.baseBranch,
      environment,
      attempt,
    })
  }
}
