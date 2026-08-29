import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import {
  type ExecutionEnvironment,
  expectedSuitePath,
  isTerminal,
  layoutFor,
  type ResolvedToolchain,
  resolveSpecConvention,
  type SpecConvention,
  type SpecLayout,
  type TaskState,
} from '@specmate/core'
import {
  artifacts,
  type Database,
  events,
  getSpecConvention,
  repositories,
  tasks,
} from '@specmate/db'
import { and, eq, isNull, like } from 'drizzle-orm'
import {
  capDiffFiles,
  resolveTaskDiffRange,
  type TaskDiffFiles,
  taskFileDiff,
  taskFilesChanged,
} from './diff.ts'
import { walkMarkdown } from './fs.ts'
import { Git } from './git.ts'
import { type IndexedArtifact, indexChangeFolder } from './index-artifacts.ts'
import type {
  CommitOutcome,
  ConversationWorkspace,
  ProvisionedTree,
  ProvisionRequest,
  StageRef,
  Workspace,
  WorkspaceManager,
} from './manager.ts'
import { changeDir, changeLayoutOf, type MirrorKey, recordedMirrorKey } from './paths.ts'
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
  /**
   * The toolchains this task is already pinned to. Present only on a re-pin,
   * where detecting them again would read the working tree as the task's own
   * committed change has left it (REQ-802).
   */
  toolchains?: readonly ResolvedToolchain[],
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
  /**
   * Null until provisioning pinned it. A task whose folder the repository does not
   * carry has no specification half in its diff, and the group then matches nothing —
   * which is what it should report (REQ-1707).
   */
  readonly changeLayout?: SpecLayout | null
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
    const tree = await this.manager.provision({
      ...request,
      mirrorKey: await this.mirrorKeyFor(task),
    })
    // What a task with no base of its own actually ran against, pinned on first
    // provision so publish and the diff read a branch rather than a convention.
    if (task.baseBranch === null) {
      await this.persistBaseBranch(request.taskId, tree.baseBranch)
    }

    const convention = await this.persistSpecConvention(
      request.taskId,
      tree,
      task.repoUrl,
      task.specConvention,
    )
    const layout = await this.persistChangeLayout(request.taskId, task.changeLayout, convention)
    // The folder's name is the task's, not the caller's: a dispatcher holding a
    // snapshot from before planning declared one would re-provision under the
    // provisional name and split the task's work across two folders.
    const workspace = await this.manager.openChangeFolder(tree, layout, task.changeName)
    await this.restoreChangeFolder(request.taskId, workspace)

    if (task.environment !== null) return workspace

    const environment = await this.resolveEnvironment(workspace, request.image)
    await this.persistInitialEnvironment(request.taskId, environment)

    return workspace
  }

  /**
   * Re-pinning is separate from provisioning so it can never happen as drift,
   * and it recovers the image only: the task's toolchains are carried across
   * rather than detected again. Detection reads the working tree, and at
   * re-pin time that tree is the task branch — a task bumping `.tool-versions`
   * would pin itself to the version its own unmerged change declares.
   */
  async repinEnvironment(
    taskId: string,
    workspace: Workspace,
    image: string,
  ): Promise<ExecutionEnvironment> {
    const task = await this.loadTask(taskId)
    if (task.slug !== workspace.slug || task.repoUrl !== workspace.repoUrl) {
      throw new WorkspaceTaskMismatchError(taskId)
    }

    // Undefined rather than empty for a task that was never pinned: it has no
    // toolchains to carry, so the resolver detects them as provisioning would.
    const environment = await this.resolveEnvironment(
      workspace,
      image,
      task.environment?.toolchains,
    )
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

  /**
   * The index follows the stage, not the commit (REQ-708): a stage whose only output is
   * a change folder the repository does not carry commits nothing, and the store is the
   * only place those artifacts exist.
   */
  async commitStage(taskId: string, workspace: Workspace, stage: StageRef): Promise<StageCommit> {
    const outcome = await this.manager.commitStage(workspace, stage)
    const indexed = await indexChangeFolder(this.db, this.git, this.manager.config, {
      taskId,
      workspace,
      commit: outcome.committed ? outcome.commit : undefined,
    })

    return { ...outcome, indexed }
  }

  async provisionConversation(
    taskId: string,
    workspace: Workspace,
    key: string,
  ): Promise<ConversationWorkspace> {
    const conversation = await this.manager.provisionConversation(workspace, key)
    await this.restoreChangeFolder(taskId, conversation)

    return conversation
  }

  /**
   * What a run wrote into a change folder the repository does not carry: `git status`
   * never reports an excluded path, so the store is what the folder is compared against
   * (REQ-208, REQ-1303). Only files that differ from what is on record — the folder is
   * restored from the store before the run, so reporting the whole of it would read
   * every restored file as this run's work.
   */
  async changedArtifacts(taskId: string, workspace: Workspace): Promise<string[]> {
    if (changeLayoutOf(workspace.changeDir) === 'repository') return []

    const stored = new Map(
      (await this.storedArtifacts(taskId, workspace)).map((artifact) => [
        artifact.path,
        artifact.snapshotMd,
      ]),
    )
    const folder = join(workspace.path, workspace.changeDir)
    const changed: string[] = []
    const present = new Set<string>()
    for (const file of await walkMarkdown(folder)) {
      const path = `${workspace.changeDir}/${relative(folder, file)}`
      present.add(path)
      const content = await readFile(file, 'utf8').catch(() => null)
      if (content !== null && stored.get(path) !== content) changed.push(path)
    }

    // A file the store carries and the tree no longer does: deleting an artifact is as
    // much a write as rewriting one, and `git status` would report it too.
    for (const path of stored.keys()) {
      if (!present.has(path)) changed.push(path)
    }

    return changed
  }

  /**
   * REQ-712: where the repository does not carry the change folder, the store is what
   * the folder is. A tree git just built holds none of it, so every artifact on record
   * is written back before anything reads it — and a markdown artifact the store does
   * not carry is removed, which is how a discarded attempt's writes stop existing.
   */
  private async restoreChangeFolder(taskId: string, workspace: Workspace): Promise<void> {
    if (changeLayoutOf(workspace.changeDir) === 'repository') return

    const stored = await this.storedArtifacts(taskId, workspace)
    const folder = join(workspace.path, workspace.changeDir)
    const kept = new Set(stored.map((artifact) => artifact.path))
    for (const file of await walkMarkdown(folder)) {
      const path = `${workspace.changeDir}/${relative(folder, file)}`
      if (!kept.has(path)) await rm(file, { force: true })
    }

    for (const artifact of stored) {
      if (artifact.snapshotMd === null) continue

      const target = join(workspace.path, artifact.path)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, artifact.snapshotMd)
    }
  }

  private storedArtifacts(taskId: string, workspace: Workspace) {
    return this.db
      .select({ path: artifacts.path, snapshotMd: artifacts.snapshotMd })
      .from(artifacts)
      .where(and(eq(artifacts.taskId, taskId), like(artifacts.path, `${workspace.changeDir}/%`)))
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

  /**
   * The commit is what a repository-kept change folder is returned to; a folder the
   * repository does not carry has no commit behind it, so the store is what it is
   * returned to instead (REQ-712/AC-748).
   */
  async discard(taskId: string, workspace: Workspace, commit?: string): Promise<void> {
    await this.manager.discard(workspace, commit)
    await this.restoreChangeFolder(taskId, workspace)
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
    const files = await taskFilesChanged(this.git, range, taskChangeDir(task))

    return { tip: range.tip, total: files.length, files: capDiffFiles(files) }
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
    workspace: ProvisionedTree,
    repoUrl: string,
    current: SpecConvention | null,
  ): Promise<SpecConvention> {
    const setting = await getSpecConvention(this.db, repoUrl)
    const tree = await readSpecConventionTree(workspace.path, expectedSuitePath(setting))
    const resolved = resolveSpecConvention(tree, setting)

    if (current && sameSpecConvention(current, resolved)) return resolved

    await this.db
      .update(tasks)
      .set({ specConvention: resolved, updatedAt: new Date() })
      .where(eq(tasks.id, taskId))

    return resolved
  }

  /**
   * Where this task's change folder stands, decided once and read back on every later
   * provisioning (REQ-1707). The profile is re-resolved above and governs what the task
   * does next (REQ-1706); moving a folder that already holds artifacts is not that, so
   * the answer is pinned rather than recomputed.
   *
   * Guarded on the column still being null, and re-read where the guard bit: two
   * provisions racing on a task that has pinned nothing must not walk away with two
   * different answers.
   */
  private async persistChangeLayout(
    taskId: string,
    pinned: SpecLayout | null,
    convention: SpecConvention,
  ): Promise<SpecLayout> {
    if (pinned) return pinned

    const layout = layoutFor(convention.profile)
    const [updated] = await this.db
      .update(tasks)
      .set({ changeLayout: layout, updatedAt: new Date() })
      .where(and(eq(tasks.id, taskId), isNull(tasks.changeLayout)))
      .returning({ changeLayout: tasks.changeLayout })
    if (updated?.changeLayout) return updated.changeLayout

    const [current] = await this.db
      .select({ changeLayout: tasks.changeLayout })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1)
    if (!current) throw new TaskNotFoundError(taskId)

    return current.changeLayout ?? layout
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

/**
 * The change folder of a task read off its record. A task provisioned before the layout
 * was pinned kept its folder in the repository, which is what a null reads as.
 */
function taskChangeDir(task: DiffTaskRef): string {
  return changeDir(task.changeLayout ?? 'repository', task.slug, task.changeName)
}

function sameSpecConvention(a: SpecConvention, b: SpecConvention): boolean {
  return (
    a.profile === b.profile &&
    a.suitePath === b.suitePath &&
    a.conventionNote === b.conventionNote &&
    a.missingSuitePath === b.missingSuitePath
  )
}
