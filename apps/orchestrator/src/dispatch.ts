import { type ExecutionEnvironment, stageModel } from '@specmate/core'
import type { ConversationExecutor, StageExecutor } from '@specmate/runner'
import type { ConversationDispatcher, StageDispatcher } from './engine.ts'
import { EnvironmentUnresolvableError, type StageEnvironment } from './environment.ts'

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
      if (!(error instanceof EnvironmentUnresolvableError)) throw error

      // No container was asked for, and asking again would ask for the same one:
      // the image is missing on the host that would have to run it (AC-818).
      return { status: 'failed', attempts: [], failure: 'backend_error', detail: error.message }
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
  readonly pinnedEnvironment: (taskId: string) => Promise<ExecutionEnvironment>
}

/** The same edge for a conversation turn, testable for the same reason. */
export function createConversationDispatcher({
  executor,
  pinnedEnvironment,
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
      environment: await pinnedEnvironment(task.id),
      attempt,
    })
  }
}
