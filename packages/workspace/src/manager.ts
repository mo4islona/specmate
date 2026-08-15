import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AgentRole, ProviderId } from '@specmate/core'
import { resolveWorkspaceConfig, type WorkspaceConfig, type WorkspaceOptions } from './config.ts'
import { isDirectory, pathExists } from './fs.ts'
import { Git } from './git.ts'
import { withDiskLock, withKeyedMutex } from './lock.ts'
import { ensureExcludes, ensureMirror, resolveBaseCommit } from './mirror.ts'
import { changeDir, mirrorPath, SCHEMA_MARKER, taskBranch, worktreePath } from './paths.ts'

export interface ProvisionRequest {
  readonly slug: string
  readonly repoUrl: string
  readonly baseBranch: string
}

export interface Workspace {
  readonly slug: string
  readonly repoUrl: string
  readonly branch: string
  /** Absolute path of the working tree — what a runner container mounts. */
  readonly path: string
  /** Change folder, relative to the working tree (see `StageJob.changeDir`). */
  readonly changeDir: string
  readonly mirrorPath: string
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
      const base = await resolveBaseCommit(this.git, mirror, request.repoUrl, request.baseBranch)
      const branch = taskBranch(request.slug)
      await this.ensureBranch(mirror, branch, base)
      await ensureExcludes(mirror)
      const path = worktreePath(this.config, request.slug)
      await this.ensureWorktree(mirror, path, branch)
      await this.scaffoldChangeFolder(path, request.slug)
      return {
        slug: request.slug,
        repoUrl: request.repoUrl,
        branch,
        path,
        changeDir: changeDir(request.slug),
        mirrorPath: mirror,
      }
    })
  }

  async commitStage(workspace: Workspace, stage: StageRef): Promise<CommitOutcome> {
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
  }

  /**
   * Restores the working tree to the last stage commit. `clean` runs without
   * `-x` on purpose: the scratch an attempt left behind — its log and its
   * result — is the evidence a human is shown, and excluded paths are exactly
   * what `-x` would delete.
   */
  async discard(workspace: Workspace): Promise<void> {
    await this.git.run(['reset', '--hard', '--quiet', 'HEAD'], { cwd: workspace.path })
    await this.git.run(['clean', '-fdq'], { cwd: workspace.path })
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
    return withKeyedMutex(mirror, () =>
      withDiskLock(
        `${mirror}.lock`,
        {
          heartbeatMs: this.config.lockHeartbeatMs,
          staleMs: this.config.lockStaleMs,
          waitMs: this.config.lockWaitMs,
        },
        fn,
      ),
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

  private async isCheckoutOf(path: string, branch: string): Promise<boolean> {
    if (!(await isDirectory(path))) return false
    const head = await this.git.tryRun(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: path })
    return head.exitCode === 0 && head.stdout.trim() === branch
  }

  private async scaffoldChangeFolder(path: string, slug: string): Promise<void> {
    const folder = join(path, changeDir(slug))
    await mkdir(folder, { recursive: true })
    const marker = join(folder, SCHEMA_MARKER)
    if (await pathExists(marker)) return
    await writeFile(marker, `schema: ${this.config.changeSchema}\n`)
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
