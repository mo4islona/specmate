import type { WorkspaceService } from '@specmate/workspace'
import type { DispatchingWorkspaces } from './engine.ts'

export interface EngineWorkspacesDeps {
  readonly service: WorkspaceService
  /**
   * The engine names tasks, not images: the default image joins here so the service
   * can pin the environment on the first provision.
   */
  readonly image: string
}

/**
 * Adapts the workspace service to what an engine that dispatches is owed. It exists
 * as a factory for the same reason the dispatchers do — the entry point cannot be
 * called, and an adapter written a second time in a test is an adapter free to drift
 * from the one production runs.
 */
export function createEngineWorkspaces({
  service,
  image,
}: EngineWorkspacesDeps): DispatchingWorkspaces {
  return {
    provision: (request) => service.provision({ ...request, image }),
    provisionConversation: (taskId, workspace, key) =>
      service.provisionConversation(taskId, workspace, key),
    releaseConversation: (task, key) => service.releaseConversation(task.slug, task.repoUrl, key),
    discard: (taskId, workspace, commit) => service.discard(taskId, workspace, commit),
    headCommit: (workspace) => service.headCommit(workspace),
    commitStage: (taskId, workspace, stage) => service.commitStage(taskId, workspace, stage),
    renameChangeFolder: (workspace, changeName) =>
      service.renameChangeFolder(workspace, changeName),
    writeDecisionLog: (workspace, markdown) => service.writeDecisionLog(workspace, markdown),
    countSpecScenarios: (workspace) => service.countSpecScenarios(workspace),
    release: (taskId) => service.release(taskId),
  }
}
