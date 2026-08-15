import { isTerminal, type TaskState } from '@specmate/core'
import { type Database, tasks } from '@specmate/db'
import { eq } from 'drizzle-orm'
import { Git } from './git.ts'
import { type IndexedArtifact, indexChangeFolder } from './index-artifacts.ts'
import type {
  CommitOutcome,
  ProvisionRequest,
  StageRef,
  Workspace,
  WorkspaceManager,
} from './manager.ts'

export class TaskNotFoundError extends Error {
  constructor(taskId: string) {
    super(`task ${taskId} does not exist`)
    this.name = 'TaskNotFoundError'
  }
}

export class WorkspaceBusyError extends Error {
  constructor(taskId: string, status: TaskState) {
    super(`workspace for task ${taskId} cannot be released while the task is ${status}`)
    this.name = 'WorkspaceBusyError'
  }
}

export type StageCommit = CommitOutcome & { readonly indexed?: IndexedArtifact[] }

/**
 * The manager knows git and nothing else; this layer is where the database
 * meets it — the artifact index after a commit, and the task status that
 * decides whether a workspace may be destroyed.
 */
export class WorkspaceService {
  private readonly git: Git

  constructor(
    private readonly manager: WorkspaceManager,
    private readonly db: Database,
    git?: Git,
  ) {
    this.git = git ?? new Git(manager.config)
  }

  provision(request: ProvisionRequest): Promise<Workspace> {
    return this.manager.provision(request)
  }

  async commitStage(taskId: string, workspace: Workspace, stage: StageRef): Promise<StageCommit> {
    const outcome = await this.manager.commitStage(workspace, stage)
    if (!outcome.committed) return outcome
    const indexed = await indexChangeFolder(this.db, this.git, this.manager.config, {
      taskId,
      workspace,
      commit: outcome.commit,
    })
    return { ...outcome, indexed }
  }

  discard(workspace: Workspace): Promise<void> {
    return this.manager.discard(workspace)
  }

  async release(taskId: string): Promise<void> {
    const [task] = await this.db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1)
    if (!task) throw new TaskNotFoundError(taskId)
    if (!isTerminal(task.status)) throw new WorkspaceBusyError(taskId, task.status)
    await this.manager.release(task.slug, task.repoUrl)
  }
}
