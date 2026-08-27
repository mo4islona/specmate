import {
  type ExecutionEnvironment,
  expectedSuitePath,
  isTerminal,
  resolveSpecConvention,
  type SpecConvention,
  type TaskState,
} from '@specmate/core'
import { type Database, events, getSpecConvention, repositories, tasks } from '@specmate/db'
import { and, eq, isNull } from 'drizzle-orm'
import { resolveTaskDiffRange, type TaskDiffFiles, taskFileDiff, taskFilesChanged } from './diff.ts'
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
import { changeDir, type MirrorKey, recordedMirrorKey } from './paths.ts'
import { readSpecConventionTree } from './spec-conventions.ts'

export const ENVIRONMENT_PINNED_EVENT = 'task.environment_pinned'
export const BASE_BRANCH_PINNED_EVENT = 'task.base_branch_pinned'
export const ENVIRONMENT_REPINNED_EVENT = 'task.environment_repinned'

/**
 * The mirror key is not the caller's to supply: the service reads it off the
 * task's repository record, which is the only place it is authoritative (D1).
 */
export interface TaskProvisionRequest extends Omit<ProvisionRequest, 'mirrorKey'> {
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
  /** The diff reads the shared mirror, and which mirror is the record's answer (D1). */
  readonly repositoryId: string
  /** Null until provisioning pinned it — a task with no branch has no diff either. */
  readonly baseBranch: string | null
  /** Null until planning named the change; the folder then stands under the slug. */
  readonly changeName?: string | null
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
    // The folder's name is the task's, not the caller's: a dispatcher holding a
    // snapshot from before planning declared one would re-provision under the
    // provisional name and split the task's work across two folders.
    const workspace = await this.manager.provision({
      ...request,
      mirrorKey: await this.mirrorKeyFor(task),
      changeName: task.changeName,
    })
    // What a task with no base of its own actually ran against, pinned on first
    // provision so publish and the diff read a branch rather than a convention.
    if (task.baseBranch === null) {
      await this.persistBaseBranch(request.taskId, workspace.baseBranch)
    }

    await this.persistSpecConvention(request.taskId, workspace, task.repoUrl, task.specConvention)

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

  countSpecScenarios(workspace: Workspace): Promise<number> {
    return this.manager.countSpecScenarios(workspace)
  }

  releaseConversation(slug: string, mirrorKey: string, key: string): Promise<void> {
    return this.manager.releaseConversation(slug, recordedMirrorKey(mirrorKey), key)
  }

  discard(workspace: Workspace, commit?: string): Promise<void> {
    return this.manager.discard(workspace, commit)
  }

  headCommit(workspace: Workspace): Promise<string> {
    return this.manager.headCommit(workspace)
  }

  /** REQ-705: the folder converges before the declaring stage's output is committed. */
  renameChangeFolder(workspace: Workspace, changeName: string): Promise<Workspace> {
    return this.manager.renameChangeFolder(workspace, changeName)
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
  async diffFiles(task: DiffTaskRef): Promise<TaskDiffFiles> {
    const range = await resolveTaskDiffRange(this.git, this.manager.config, {
      ...task,
      mirrorKey: await this.mirrorKeyFor(task),
    })
    const files = await taskFilesChanged(this.git, range, changeDir(task.slug, task.changeName))

    return { tip: range.tip, files }
  }

  async diffFile(task: DiffTaskRef, path: string, context?: number): Promise<string> {
    const range = await resolveTaskDiffRange(this.git, this.manager.config, {
      ...task,
      mirrorKey: await this.mirrorKeyFor(task),
    })

    return taskFileDiff(this.git, range, path, context)
  }

  async release(taskId: string): Promise<void> {
    const task = await this.loadTask(taskId)
    if (!isTerminal(task.status)) throw new WorkspaceBusyError(taskId, task.status)

    await this.manager.release(task.slug, await this.mirrorKeyFor(task))
  }

  /**
   * Guarded on the column still being null, so two provisions racing on a task
   * that named no branch cannot write two different answers.
   */
  private async persistBaseBranch(taskId: string, baseBranch: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(tasks)
        .set({ baseBranch, updatedAt: new Date() })
        .where(and(eq(tasks.id, taskId), isNull(tasks.baseBranch)))
        .returning({ id: tasks.id })
      if (!updated) return

      await tx.insert(events).values({
        taskId,
        type: BASE_BRANCH_PINNED_EVENT,
        payload: { baseBranch },
      })
    })
  }

  /**
   * REQ-1702. Provisioning is the only code that sees the working tree and the owner's
   * setting at once, and it runs before every stage — so a setting changed between two
   * stages is picked up by the next one, with no cache to invalidate.
   *
   * Written only where the answer actually moved: re-resolving the same profile before
   * every stage would bump `updated_at` on each one and make a task look edited.
   */
  private async persistSpecConvention(
    taskId: string,
    workspace: Workspace,
    repoUrl: string,
    current: SpecConvention | null,
  ): Promise<void> {
    const setting = await getSpecConvention(this.db, repoUrl)
    const tree = await readSpecConventionTree(workspace.path, expectedSuitePath(setting))
    const resolved = resolveSpecConvention(tree, setting)

    if (current && sameSpecConvention(current, resolved)) return

    await this.db
      .update(tasks)
      .set({ specConvention: resolved, updatedAt: new Date() })
      .where(eq(tasks.id, taskId))
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

  /**
   * The name this task's repository is filed under. Read off the record rather
   * than derived from `task.repoUrl` (D1): the task holds the spelling its own
   * launch used, and two spellings must not become two mirrors.
   */
  private async mirrorKeyFor(task: { repositoryId: string }): Promise<MirrorKey> {
    const [row] = await this.db
      .select({ mirrorKey: repositories.mirrorKey })
      .from(repositories)
      .where(eq(repositories.id, task.repositoryId))
      .limit(1)
    if (!row) throw new Error(`task names a repository that has no record: ${task.repositoryId}`)

    return recordedMirrorKey(row.mirrorKey)
  }

  private async loadTask(taskId: string) {
    const [task] = await this.db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1)
    if (!task) throw new TaskNotFoundError(taskId)

    return task
  }

  private assertMatchesTask(request: TaskProvisionRequest, task: typeof tasks.$inferSelect): void {
    // Either side may leave the branch open: the request before provisioning
    // pinned one, the task before its first provision. Only two concrete
    // branches that disagree are drift.
    const branchDrift =
      request.baseBranch !== undefined &&
      task.baseBranch !== null &&
      request.baseBranch !== task.baseBranch

    if (task.slug !== request.slug || task.repoUrl !== request.repoUrl || branchDrift) {
      throw new WorkspaceTaskMismatchError(request.taskId)
    }
  }
}

function sameSpecConvention(a: SpecConvention, b: SpecConvention): boolean {
  return (
    a.profile === b.profile &&
    a.suitePath === b.suitePath &&
    a.conventionNote === b.conventionNote &&
    a.missingSuitePath === b.missingSuitePath
  )
}
