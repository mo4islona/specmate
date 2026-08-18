import { afterAll, describe, expect, test } from 'bun:test'
import { rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import {
  Git,
  GitError,
  mirrorPath,
  resolveTaskDiffRange,
  type StageRef,
  TaskBranchMissingError,
  taskBranch,
  taskFileDiff,
  taskFilesChanged,
  withMirrorLock,
} from '../src/index.ts'
import { cleanupTempDirs, makeManager, makeOrigin, writeFiles } from './fixtures.ts'

const STAGE: StageRef = {
  stageId: '3f6f0f5e-0f1a-4a3a-9d3c-000000000002',
  role: 'implementer',
  provider: 'claude-code',
  attempt: 1,
}

afterAll(cleanupTempDirs)

describe('task diff range', () => {
  test('resolves the merge-base and tip of a provisioned task branch', async () => {
    const origin = await makeOrigin()
    const { manager } = await makeManager()
    const workspace = await manager.provision({
      slug: 'diff-range',
      repoUrl: origin.url,
      baseBranch: 'main',
    })
    const git = new Git(manager.config)

    const range = await resolveTaskDiffRange(git, manager.config, {
      repoUrl: origin.url,
      baseBranch: 'main',
      slug: 'diff-range',
    })

    expect(range.base).toBe(await origin.head())
    expect(range.tip).toBe(await origin.head())
    expect(range.mirror).toBe(workspace.mirrorPath)
  })

  test('rejects a task whose branch was never provisioned', async () => {
    const origin = await makeOrigin()
    const { manager } = await makeManager()
    const git = new Git(manager.config)

    const range = resolveTaskDiffRange(git, manager.config, {
      repoUrl: origin.url,
      baseBranch: 'main',
      slug: 'never-provisioned',
    })

    await expect(range).rejects.toThrow(TaskBranchMissingError)
  })

  test('rejects a task branch that shares no history with its base', async () => {
    const origin = await makeOrigin()
    const { manager } = await makeManager()
    const git = new Git(manager.config)
    const workspace = await manager.provision({
      slug: 'unrelated-history',
      repoUrl: origin.url,
      baseBranch: 'main',
    })

    const stranger = await makeOrigin({ 'STRANGER.md': '# unrelated history\n' }, 'stranger')
    const strangerHead = await stranger.head()
    await git.inMirror(workspace.mirrorPath, ['fetch', '--quiet', stranger.dir, 'stranger'])
    await git.inMirror(workspace.mirrorPath, [
      'update-ref',
      `refs/heads/${taskBranch('unrelated-history')}`,
      strangerHead,
    ])

    const range = resolveTaskDiffRange(git, manager.config, {
      repoUrl: origin.url,
      baseBranch: 'main',
      slug: 'unrelated-history',
    })

    await expect(range).rejects.toThrow(GitError)
  })

  test('serializes with a concurrent mirror-lock holder (regression)', async () => {
    const origin = await makeOrigin()
    const { manager } = await makeManager()
    const git = new Git(manager.config)
    await manager.provision({ slug: 'lock-order', repoUrl: origin.url, baseBranch: 'main' })

    const mirror = mirrorPath(manager.config, origin.url)
    const lockOptions = {
      heartbeatMs: manager.config.lockHeartbeatMs,
      staleMs: manager.config.lockStaleMs,
      waitMs: manager.config.lockWaitMs,
    }
    const order: string[] = []

    const holder = withMirrorLock(mirror, lockOptions, async () => {
      order.push('holder:enter')
      await Bun.sleep(80)
      order.push('holder:exit')
    })
    await Bun.sleep(10)

    const reader = resolveTaskDiffRange(git, manager.config, {
      repoUrl: origin.url,
      baseBranch: 'main',
      slug: 'lock-order',
    }).then(() => order.push('diff:done'))

    await Promise.all([holder, reader])

    expect(order).toEqual(['holder:enter', 'holder:exit', 'diff:done'])
  })
})

describe('files changed', () => {
  test('keeps the full path when a file name contains a tab', async () => {
    const origin = await makeOrigin()
    const { manager } = await makeManager()
    const git = new Git(manager.config)
    const workspace = await manager.provision({
      slug: 'tab-path',
      repoUrl: origin.url,
      baseBranch: 'main',
    })
    await writeFiles(workspace.path, { 'src/foo\tbar.ts': 'export const a = 1\n' })
    await manager.commitStage(workspace, STAGE)

    const range = await resolveTaskDiffRange(git, manager.config, {
      repoUrl: origin.url,
      baseBranch: 'main',
      slug: 'tab-path',
    })
    const files = await taskFilesChanged(git, range, workspace.changeDir)

    expect(files).toEqual([
      { path: 'src/foo\tbar.ts', status: 'added', additions: 1, deletions: 0 },
    ])
  })

  test('lists product-code files with status and line counts', async () => {
    const origin = await makeOrigin()
    const { manager } = await makeManager()
    const git = new Git(manager.config)
    const workspace = await manager.provision({
      slug: 'has-commits',
      repoUrl: origin.url,
      baseBranch: 'main',
    })
    await writeFiles(workspace.path, {
      'src/new-file.ts': 'export const a = 1\n',
      'README.md': '# origin\nextra line\n',
    })
    await manager.commitStage(workspace, STAGE)

    const range = await resolveTaskDiffRange(git, manager.config, {
      repoUrl: origin.url,
      baseBranch: 'main',
      slug: 'has-commits',
    })
    const files = await taskFilesChanged(git, range, workspace.changeDir)

    expect(files).toEqual(
      expect.arrayContaining([
        { path: 'src/new-file.ts', status: 'added', additions: 1, deletions: 0 },
        { path: 'README.md', status: 'modified', additions: 1, deletions: 0 },
      ]),
    )
    expect(files).toHaveLength(2)
  })

  test('returns an empty list before any product-code commit exists (AC-1035)', async () => {
    const origin = await makeOrigin()
    const { manager } = await makeManager()
    const git = new Git(manager.config)
    await manager.provision({ slug: 'no-commits', repoUrl: origin.url, baseBranch: 'main' })

    const range = await resolveTaskDiffRange(git, manager.config, {
      repoUrl: origin.url,
      baseBranch: 'main',
      slug: 'no-commits',
    })
    const files = await taskFilesChanged(git, range, 'openspec/changes/no-commits')

    expect(files).toEqual([])
  })

  test('excludes a commit that only touches the change folder', async () => {
    const origin = await makeOrigin()
    const { manager } = await makeManager()
    const git = new Git(manager.config)
    const workspace = await manager.provision({
      slug: 'change-only',
      repoUrl: origin.url,
      baseBranch: 'main',
    })
    await writeFiles(workspace.path, {
      'openspec/changes/change-only/proposal.md': '# proposal\n',
    })
    await manager.commitStage(workspace, STAGE)

    const range = await resolveTaskDiffRange(git, manager.config, {
      repoUrl: origin.url,
      baseBranch: 'main',
      slug: 'change-only',
    })
    const files = await taskFilesChanged(git, range, workspace.changeDir)

    expect(files).toEqual([])
  })

  test('marks a removed file with status "deleted"', async () => {
    const origin = await makeOrigin({
      'README.md': '# origin\n',
      'src/existing.ts': 'export const existing = 1\n',
    })
    const { manager } = await makeManager()
    const git = new Git(manager.config)
    const workspace = await manager.provision({
      slug: 'deleted-file',
      repoUrl: origin.url,
      baseBranch: 'main',
    })
    await rm(join(workspace.path, 'src/existing.ts'))
    await manager.commitStage(workspace, STAGE)

    const range = await resolveTaskDiffRange(git, manager.config, {
      repoUrl: origin.url,
      baseBranch: 'main',
      slug: 'deleted-file',
    })
    const files = await taskFilesChanged(git, range, workspace.changeDir)

    expect(files).toEqual([
      { path: 'src/existing.ts', status: 'deleted', additions: 0, deletions: 1 },
    ])
  })

  test('marks a file whose type changed (regular file to symlink) with status "type-changed"', async () => {
    const origin = await makeOrigin({
      'README.md': '# origin\n',
      'src/target.ts': 'export const target = 1\n',
    })
    const { manager } = await makeManager()
    const git = new Git(manager.config)
    const workspace = await manager.provision({
      slug: 'type-changed-file',
      repoUrl: origin.url,
      baseBranch: 'main',
    })
    await rm(join(workspace.path, 'src/target.ts'))
    await symlink('README.md', join(workspace.path, 'src/target.ts'))
    await manager.commitStage(workspace, STAGE)

    const range = await resolveTaskDiffRange(git, manager.config, {
      repoUrl: origin.url,
      baseBranch: 'main',
      slug: 'type-changed-file',
    })
    const files = await taskFilesChanged(git, range, workspace.changeDir)

    expect(files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'src/target.ts', status: 'type-changed' }),
      ]),
    )
  })
})

describe('one file diff', () => {
  test('returns the unified diff for the requested path', async () => {
    const origin = await makeOrigin()
    const { manager } = await makeManager()
    const git = new Git(manager.config)
    const workspace = await manager.provision({
      slug: 'one-file',
      repoUrl: origin.url,
      baseBranch: 'main',
    })
    await writeFiles(workspace.path, { 'src/thing.ts': 'export const thing = 2\n' })
    await manager.commitStage(workspace, STAGE)

    const range = await resolveTaskDiffRange(git, manager.config, {
      repoUrl: origin.url,
      baseBranch: 'main',
      slug: 'one-file',
    })
    const diff = await taskFileDiff(git, range, 'src/thing.ts', workspace.changeDir)

    expect(diff).toContain('+export const thing = 2')
  })

  test('rejects a directory-shaped path instead of returning every file (regression)', async () => {
    const origin = await makeOrigin()
    const { manager } = await makeManager()
    const git = new Git(manager.config)
    const workspace = await manager.provision({
      slug: 'directory-path',
      repoUrl: origin.url,
      baseBranch: 'main',
    })
    await writeFiles(workspace.path, {
      'src/one.ts': 'export const one = 1\n',
      'src/two.ts': 'export const two = 2\n',
    })
    await manager.commitStage(workspace, STAGE)

    const range = await resolveTaskDiffRange(git, manager.config, {
      repoUrl: origin.url,
      baseBranch: 'main',
      slug: 'directory-path',
    })

    // `.`, `src`, and `src/` all still match every file under them even with
    // `:(literal)` — git's directory-prefix matching, not glob magic.
    for (const path of ['.', 'src', 'src/']) {
      expect(await taskFileDiff(git, range, path, workspace.changeDir)).toBe('')
    }
  })

  test('excludes the task change folder even when requested directly', async () => {
    const origin = await makeOrigin()
    const { manager } = await makeManager()
    const git = new Git(manager.config)
    const workspace = await manager.provision({
      slug: 'exclude-change-dir',
      repoUrl: origin.url,
      baseBranch: 'main',
    })
    await writeFiles(workspace.path, {
      'openspec/changes/exclude-change-dir/proposal.md': '# proposal\n',
    })
    await manager.commitStage(workspace, STAGE)

    const range = await resolveTaskDiffRange(git, manager.config, {
      repoUrl: origin.url,
      baseBranch: 'main',
      slug: 'exclude-change-dir',
    })
    const diff = await taskFileDiff(
      git,
      range,
      'openspec/changes/exclude-change-dir/proposal.md',
      workspace.changeDir,
    )

    expect(diff).toBe('')
  })
})

describe('a task whose workspace has been released (AC-1037)', () => {
  test('reads the same diff after the worktree is removed', async () => {
    const origin = await makeOrigin()
    const { manager } = await makeManager()
    const git = new Git(manager.config)
    const workspace = await manager.provision({
      slug: 'released',
      repoUrl: origin.url,
      baseBranch: 'main',
    })
    await writeFiles(workspace.path, { 'src/kept.ts': 'export const kept = true\n' })
    await manager.commitStage(workspace, STAGE)

    const before = await taskFilesChanged(
      git,
      await resolveTaskDiffRange(git, manager.config, {
        repoUrl: origin.url,
        baseBranch: 'main',
        slug: 'released',
      }),
      workspace.changeDir,
    )

    await manager.release('released', origin.url)

    const after = await taskFilesChanged(
      git,
      await resolveTaskDiffRange(git, manager.config, {
        repoUrl: origin.url,
        baseBranch: 'main',
        slug: 'released',
      }),
      workspace.changeDir,
    )

    expect(after).toEqual(before)
  })
})
