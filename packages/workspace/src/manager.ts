import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AgentRole, ProviderId } from '@specmate/core'
import { resolveWorkspaceConfig, type WorkspaceConfig, type WorkspaceOptions } from './config.ts'
import { isDirectory, pathExists } from './fs.ts'
import { Git } from './git.ts'
import { withMirrorLock as lockMirror } from './lock.ts'
import { ensureExcludes, ensureMirror, resolveBaseCommit, resolveDefaultBranch } from './mirror.ts'
import {
  changeDir,
  conversationWorktreePath,
  DECISION_LOG_FILE,
  mirrorPath,
  SCHEMA_MARKER,
  taskBranch,
  worktreePath,
} from './paths.ts'

export interface ProvisionRequest {
  readonly slug: string
  readonly repoUrl: string
  /** Absent means the repository's default branch, resolved here (REQ-703). */
  readonly baseBranch?: string
  /** What planning called the change; absent leaves the folder under the slug (REQ-705). */
  readonly changeName?: string | null
}

export interface Workspace {
  readonly slug: string
  readonly repoUrl: string
  readonly branch: string
  /** The base branch the task branch was actually cut from. */
  readonly baseBranch: string
  /** Absolute path of the working tree — what a runner container mounts. */
  readonly path: string
  /** Change folder, relative to the working tree (see `StageJob.changeDir`). */
  readonly changeDir: string
  readonly mirrorPath: string
}

/** A clean, detached snapshot destroyed after one conversation response attempt. */
export interface ConversationWorkspace extends Workspace {
  readonly kind: 'conversation'
  readonly key: string
  readonly sourceBranch: string
}

export class InvalidConversationWorkspaceKeyError extends Error {
  constructor(key: string) {
    super(`conversation workspace key is not safe: ${JSON.stringify(key)}`)
    this.name = 'InvalidConversationWorkspaceKeyError'
  }
}

export interface StageRef {
  readonly stageId: string
  readonly role: AgentRole
  readonly provider: ProviderId
  readonly attempt: number
}

export type CommitOutcome =
  | { readonly committed: false }
  | { readonly committed: true; readonly commit: string; readonly files: readonly string[] }

export interface WorkspaceManagerDeps {
  readonly config?: WorkspaceOptions
  readonly git?: Git
}

export class WorkspaceManager {
  readonly config: WorkspaceConfig
  private readonly git: Git

  constructor(deps: WorkspaceManagerDeps = {}) {
    this.config = resolveWorkspaceConfig(deps.config)
    this.git = deps.git ?? new Git(this.config)
  }

  /**
   * Boot check: the root is writable and git is callable. A process that cannot
   * run git can only fail every task it picks up, so it should not start.
   */
  async preflight(): Promise<{ root: string; gitVersion: string }> {
    await mkdir(this.config.root, { recursive: true })
    const version = await this.git.run(['--version'])
    return { root: this.config.root, gitVersion: version.stdout.trim() }
  }

  /**
   * Converges on a usable workspace from any prior state: nothing, a cache
   * without a branch, a branch without a working tree, or a working tree that
   * no longer matches its branch. Every path is derived from the slug, so the
   * filesystem is the only bookkeeping there is.
   */
  async provision(request: ProvisionRequest): Promise<Workspace> {
    const mirror = mirrorPath(this.config, request.repoUrl)
    return this.withMirrorLock(mirror, async () => {
      await ensureMirror(this.git, this.config, request.repoUrl)
      const baseBranch =
        request.baseBranch ?? (await resolveDefaultBranch(this.git, mirror, request.repoUrl))

      const base = await resolveBaseCommit(this.git, mirror, request.repoUrl, baseBranch)
      const branch = taskBranch(request.slug)
      await this.ensureBranch(mirror, branch, base)
      await ensureExcludes(mirror)
      const path = worktreePath(this.config, request.slug)
      await this.ensureWorktree(mirror, path, branch)
      const folder = await this.scaffoldChangeFolder(path, request.slug, request.changeName)
      return {
        slug: request.slug,
        repoUrl: request.repoUrl,
        branch,
        baseBranch,
        path,
        changeDir: folder,
        mirrorPath: mirror,
      }
    })
  }

  /**
   * Checks out the task's current commit into a clean detached worktree. The
   * primary task branch remains available to stages, and deleting this tree
   * removes every transcript, ignored file, edit, and commit a response made.
   */
  async provisionConversation(workspace: Workspace, key: string): Promise<ConversationWorkspace> {
    assertConversationWorkspaceKey(key)
    const path = conversationWorktreePath(this.config, workspace.slug, key)

    return this.withMirrorLock(workspace.mirrorPath, async () => {
      const head = await this.git.run(['rev-parse', 'HEAD'], { cwd: workspace.path })
      await this.removeWorktree(workspace.mirrorPath, path)
      await mkdir(dirname(path), { recursive: true })
      try {
        await this.git.inMirror(workspace.mirrorPath, [
          'worktree',
          'add',
          '--detach',
          path,
          head.stdout.trim(),
        ])
      } catch (error) {
        await this.removeWorktree(workspace.mirrorPath, path)
        throw error
      }

      return {
        ...workspace,
        kind: 'conversation',
        key,
        sourceBranch: workspace.branch,
        branch: head.stdout.trim(),
        path,
      }
    })
  }

  /** Removes a disposable conversation checkout and commits reachable only from it. */
  async releaseConversation(slug: string, repoUrl: string, key: string): Promise<void> {
    assertConversationWorkspaceKey(key)
    const path = conversationWorktreePath(this.config, slug, key)
    const mirror = mirrorPath(this.config, repoUrl)

    await this.withMirrorLock(mirror, async () => {
      await this.removeWorktree(mirror, path)
    })
  }

  /**
   * Mirror-locked like every other method touching `workspace.path`: a task's
   * stage and its conversation responses now dispatch concurrently and share
   * this one worktree, so a commit racing a conversation's HEAD read (or
   * another commit, or a discard) is a real TOCTOU otherwise.
   */
  async commitStage(workspace: Workspace, stage: StageRef): Promise<CommitOutcome> {
    return this.withMirrorLock(workspace.mirrorPath, async () => {
      await this.git.run(['add', '-A'], { cwd: workspace.path })
      const status = await this.git.run(['status', '--porcelain=v1', '-z'], { cwd: workspace.path })
      const files = parseStatus(status.stdout)
      if (files.length === 0) return { committed: false }

      const subject = `chore(${workspace.slug}): ${stage.role} stage output`
      const trailers = [
        `Task: ${workspace.slug}`,
        `Stage: ${stage.stageId}`,
        `Role: ${stage.role}`,
        `Provider: ${stage.provider}`,
        `Attempt: ${stage.attempt}`,
      ].join('\n')
      // Target repositories are foreign property: their hooks may lint, rewrite,
      // or refuse, and a stage's durability must not depend on them.
      await this.git.run(['commit', '--no-verify', '-m', subject, '-m', trailers], {
        cwd: workspace.path,
      })
      const head = await this.git.run(['rev-parse', 'HEAD'], { cwd: workspace.path })
      return { committed: true, commit: head.stdout.trim(), files }
    })
  }

  /**
   * Restores the working tree to the last stage commit. `clean` runs without
   * `-x` on purpose: the scratch an attempt left behind — its log and its
   * result — is the evidence a human is shown, and excluded paths are exactly
   * what `-x` would delete.
   */
  async discard(workspace: Workspace, commit = 'HEAD'): Promise<void> {
    await this.withMirrorLock(workspace.mirrorPath, async () => {
      await this.git.run(['reset', '--hard', '--quiet', commit], { cwd: workspace.path })
      await this.git.run(['clean', '-fdq'], { cwd: workspace.path })
    })
  }

  /**
   * Overwrites the change folder's decision log with the store's rendering.
   * Called before every stage dispatch, so a role's own edits to the file
   * never survive into the next stage's context — the store stays
   * authoritative, and a re-provisioned workspace reproduces the log rather
   * than losing it with the tree.
   */
  async writeDecisionLog(workspace: Workspace, markdown: string): Promise<void> {
    return this.withMirrorLock(workspace.mirrorPath, async () => {
      const folder = join(workspace.path, workspace.changeDir)
      await mkdir(folder, { recursive: true })
      await writeFile(join(folder, DECISION_LOG_FILE), markdown)
    })
  }

  /**
   * How many scenarios the change's specs declare. Counted from the headings
   * rather than parsed: a conditional node reads it to decide whether reviewing
   * this spec is worth a stage, and that question is about how many separate
   * claims the spec makes, not about how the file is structured.
   */
  async countSpecScenarios(workspace: Workspace): Promise<number> {
    return this.withMirrorLock(workspace.mirrorPath, async () => {
      const specs = join(workspace.path, workspace.changeDir, 'specs')
      let total = 0
      for (const file of await walkMarkdown(specs)) {
        const text = await readFile(file, 'utf8')
        total += text.split('\n').filter((line) => line.startsWith('#### Scenario:')).length
      }

      return total
    })
  }

  /**
   * Moves the task's change folder onto the name its planning declared, and
   * answers with the workspace naming where the folder actually ended up —
   * which is not always the name asked for (REQ-705/AC-742).
   */
  async renameChangeFolder(workspace: Workspace, changeName: string): Promise<Workspace> {
    return this.withMirrorLock(workspace.mirrorPath, async () => {
      const folder = await this.scaffoldChangeFolder(workspace.path, workspace.slug, changeName)

      return { ...workspace, changeDir: folder }
    })
  }

  async headCommit(workspace: Workspace): Promise<string> {
    return this.withMirrorLock(workspace.mirrorPath, async () => {
      const head = await this.git.run(['rev-parse', 'HEAD'], { cwd: workspace.path })

      return head.stdout.trim()
    })
  }

  /** Removes the working tree; the branch and its commits stay in the cache. */
  async release(slug: string, repoUrl: string): Promise<void> {
    const mirror = mirrorPath(this.config, repoUrl)
    const path = worktreePath(this.config, slug)
    await this.withMirrorLock(mirror, async () => {
      if (await pathExists(path)) {
        await this.git.tryInMirror(mirror, ['worktree', 'remove', '--force', path])
        await rm(path, { recursive: true, force: true })
      }
      if (await isDirectory(mirror)) {
        await this.git.tryInMirror(mirror, ['worktree', 'prune'])
      }
    })
  }

  private withMirrorLock<T>(mirror: string, fn: () => Promise<T>): Promise<T> {
    return lockMirror(
      mirror,
      {
        heartbeatMs: this.config.lockHeartbeatMs,
        staleMs: this.config.lockStaleMs,
        waitMs: this.config.lockWaitMs,
      },
      fn,
    )
  }

  private async ensureBranch(mirror: string, branch: string, base: string): Promise<void> {
    const existing = await this.git.tryInMirror(mirror, [
      'rev-parse',
      '--verify',
      '--quiet',
      `refs/heads/${branch}`,
    ])
    // An existing task branch is never moved: the base advancing upstream must
    // not rewrite work already done under the old base.
    if (existing.exitCode === 0) return
    await this.git.inMirror(mirror, ['branch', branch, base])
  }

  private async ensureWorktree(mirror: string, path: string, branch: string): Promise<void> {
    if (await this.isCheckoutOf(path, branch)) return
    if (await pathExists(path)) await rm(path, { recursive: true, force: true })
    await this.git.tryInMirror(mirror, ['worktree', 'prune'])
    await mkdir(dirname(path), { recursive: true })
    await this.git.inMirror(mirror, ['worktree', 'add', path, branch])
  }

  private async removeWorktree(mirror: string, path: string): Promise<void> {
    if (await pathExists(path)) {
      await this.git.tryInMirror(mirror, ['worktree', 'remove', '--force', path])
      await rm(path, { recursive: true, force: true })
    }
    if (await isDirectory(mirror)) await this.git.tryInMirror(mirror, ['worktree', 'prune'])
  }

  private async isCheckoutOf(path: string, branch: string): Promise<boolean> {
    if (!(await isDirectory(path))) return false
    const head = await this.git.tryRun(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: path })
    return head.exitCode === 0 && head.stdout.trim() === branch
  }

  /**
   * Converges on the one folder this task's work belongs in and returns its
   * path, working-tree-relative (REQ-705). The rename only ever happens while
   * the folder is still untracked — which is exactly the window before the
   * declaring stage's own commit — so no history ever carries two names for it.
   */
  private async scaffoldChangeFolder(
    path: string,
    slug: string,
    changeName?: string | null,
  ): Promise<string> {
    const folder = await this.convergeChangeDir(path, slug, changeName)
    await mkdir(join(path, folder), { recursive: true })

    const marker = join(path, folder, SCHEMA_MARKER)
    if (!(await pathExists(marker))) {
      await writeFile(marker, `schema: ${this.config.changeSchema}\n`)
    }

    return folder
  }

  private async convergeChangeDir(
    path: string,
    slug: string,
    changeName?: string | null,
  ): Promise<string> {
    const provisional = changeDir(slug)
    if (!changeName || changeName === slug) return provisional

    const standing = await isDirectory(join(path, provisional))
    // Nothing standing under the provisional name means this task already
    // converged; the declared folder is its own, suffix and all.
    if (!standing) return changeDir(changeName)

    // A name the repository has already used for something else is not this
    // task's to write into, and the two sharing one folder is the failure
    // (AC-742). The task's own identity is what separates them.
    const taken = await isDirectory(join(path, changeDir(changeName)))
    const declared = taken ? `${changeDir(changeName)}-${slug.slice(-8)}` : changeDir(changeName)

    // Renaming a folder already in the history would rewrite paths the stage
    // results and artifact rows point at; the provisional name stands.
    if (await this.isTracked(path, provisional)) return provisional

    const moved = await this.git.tryRun(['mv', provisional, declared], { cwd: path })
    if (moved.exitCode !== 0) {
      await mkdir(dirname(join(path, declared)), { recursive: true })
      await rename(join(path, provisional), join(path, declared))
    }

    return declared
  }

  private async isTracked(path: string, folder: string): Promise<boolean> {
    const tracked = await this.git.tryRun(['ls-files', '--', folder], { cwd: path })

    return tracked.exitCode === 0 && tracked.stdout.trim().length > 0
  }
}

/** `--porcelain=v1 -z`: NUL-separated, renames carry their source as the next field. */
function parseStatus(raw: string): string[] {
  const parts = raw.split('\0').filter((part) => part.length > 0)
  const files: string[] = []
  let i = 0
  while (i < parts.length) {
    const entry = parts[i] ?? ''
    i += 1
    if (entry.startsWith('R') || entry.startsWith('C')) i += 1
    files.push(entry.slice(3))
  }
  return files
}

function assertConversationWorkspaceKey(key: string): void {
  if (key === '.' || key === '..' || !/^[a-zA-Z0-9._-]+$/.test(key)) {
    throw new InvalidConversationWorkspaceKeyError(key)
  }
}

/** Every markdown file under a directory, or none where the directory is absent. */
async function walkMarkdown(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const files: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walkMarkdown(full)))
    } else if (entry.name.endsWith('.md')) {
      files.push(full)
    }
  }

  return files
}
