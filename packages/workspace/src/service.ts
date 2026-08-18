import { type ExecutionEnvironment, isTerminal, type TaskState } from '@specmate/core'
import { type Database, events, tasks } from '@specmate/db'
import { and, eq, isNull } from 'drizzle-orm'
import { type DiffFile, resolveTaskDiffRange, taskFileDiff, taskFilesChanged } from './diff.ts'
import { Git } from './git.ts'
import { type IndexedArtifact, indexChangeFolder } from './index-artifacts.ts'
import type {
  CommitOutcome,
  ConversationWorkspace,
  ProvisionRequest,
  StageRef,
  Workspace,
  WorkspaceManager,
} from './manager.ts'
import { changeDir } from './paths.ts'

export const ENVIRONMENT_PINNED_EVENT = 'task.environment_pinned'
export const ENVIRONMENT_REPINNED_EVENT = 'task.environment_repinned'

export interface TaskProvisionRequest extends ProvisionRequest {
  readonly taskId: string
  readonly image: string
}

export type EnvironmentResolver = (
  workspace: Workspace,
  image: string,
) => Promise<ExecutionEnvironment>

export interface DiffTaskRef {
  readonly slug: string
  readonly repoUrl: string
  readonly baseBranch: string
}

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

export class WorkspaceTaskMismatchError extends Error {
  constructor(taskId: string) {
    super(`workspace request does not match task ${taskId}`)
    this.name = 'WorkspaceTaskMismatchError'
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
    private readonly resolveEnvironment: EnvironmentResolver,
    git?: Git,
  ) {
    this.git = git ?? new Git(manager.config)
  }

  async provision(request: TaskProvisionRequest): Promise<Workspace> {
    const task = await this.loadTask(request.taskId)
    this.assertMatchesTask(request, task)
    const workspace = await this.manager.provision(request)
    if (task.environment !== null) return workspace

    const environment = await this.resolveEnvironment(workspace, request.image)
    await this.persistInitialEnvironment(request.taskId, environment)

    return workspace
  }

  /** Re-pinning is separate from provisioning so it can never happen as drift. */
  async repinEnvironment(
    taskId: string,
    workspace: Workspace,
    image: string,
  ): Promise<ExecutionEnvironment> {
    const task = await this.loadTask(taskId)
    if (task.slug !== workspace.slug || task.repoUrl !== workspace.repoUrl) {
      throw new WorkspaceTaskMismatchError(taskId)
    }

    const environment = await this.resolveEnvironment(workspace, image)
    await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(tasks)
        .set({ environment, updatedAt: new Date() })
        .where(eq(tasks.id, taskId))
        .returning({ id: tasks.id })
      if (!updated) throw new TaskNotFoundError(taskId)

      await tx.insert(events).values({
        taskId,
        type: ENVIRONMENT_REPINNED_EVENT,
        payload: { previous: task.environment, environment },
      })
    })

    return environment
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

  provisionConversation(workspace: Workspace, key: string): Promise<ConversationWorkspace> {
    return this.manager.provisionConversation(workspace, key)
  }

  writeDecisionLog(workspace: Workspace, markdown: string): Promise<void> {
    return this.manager.writeDecisionLog(workspace, markdown)
  }

  releaseConversation(slug: string, repoUrl: string, key: string): Promise<void> {
    return this.manager.releaseConversation(slug, repoUrl, key)
  }

  discard(workspace: Workspace, commit?: string): Promise<void> {
    return this.manager.discard(workspace, commit)
  }

  headCommit(workspace: Workspace): Promise<string> {
    return this.manager.headCommit(workspace)
  }

  /**
   * Reads straight from the shared mirror rather than `workspace.path`, so
   * this works for a task whose per-task worktree has already been released
   * (REQ-1013/AC-1037) — there is no live checkout to depend on.
   *
   * Takes the task itself rather than a taskId: both diff routes already
   * load the task to check it exists before calling in, and a second,
   * identical `SELECT` here would be pure waste on an endpoint an operator
   * re-fetches while browsing files.
   */
  async diffFiles(task: DiffTaskRef): Promise<DiffFile[]> {
    const range = await resolveTaskDiffRange(this.git, this.manager.config, task)

    return taskFilesChanged(this.git, range, changeDir(task.slug))
  }

  async diffFile(task: DiffTaskRef, path: string): Promise<string> {
    const range = await resolveTaskDiffRange(this.git, this.manager.config, task)

    return taskFileDiff(this.git, range, path, changeDir(task.slug))
  }

  async release(taskId: string): Promise<void> {
    const task = await this.loadTask(taskId)
    if (!isTerminal(task.status)) throw new WorkspaceBusyError(taskId, task.status)

    await this.manager.release(task.slug, task.repoUrl)
  }

  private async persistInitialEnvironment(
    taskId: string,
    environment: ExecutionEnvironment,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(tasks)
        .set({ environment, updatedAt: new Date() })
        .where(and(eq(tasks.id, taskId), isNull(tasks.environment)))
        .returning({ id: tasks.id })
      if (!updated) {
        const [task] = await tx
          .select({ id: tasks.id })
          .from(tasks)
          .where(eq(tasks.id, taskId))
          .limit(1)
        if (!task) throw new TaskNotFoundError(taskId)

        return
      }

      await tx.insert(events).values({
        taskId,
        type: ENVIRONMENT_PINNED_EVENT,
        payload: { environment },
      })
    })
  }

  private async loadTask(taskId: string) {
    const [task] = await this.db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1)
    if (!task) throw new TaskNotFoundError(taskId)

    return task
  }

  private assertMatchesTask(request: TaskProvisionRequest, task: typeof tasks.$inferSelect): void {
    if (
      task.slug !== request.slug ||
      task.repoUrl !== request.repoUrl ||
      task.baseBranch !== request.baseBranch
    ) {
      throw new WorkspaceTaskMismatchError(request.taskId)
    }
  }
}
