import { afterAll, describe, expect, it } from 'bun:test'
import { rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import {
  capDiffFiles,
  type DiffFile,
  Git,
  GitError,
  MAX_DIFF_CONTEXT,
  MAX_DIFF_FILES,
  mirrorKey,
  mirrorPath,
  resolveTaskDiffRange,
  type StageRef,
  TaskBranchMissingError,
  taskBranch,
  taskFileDiff,
  taskFilesChanged,
  withMirrorLock,
} from '../src/index.ts'
import {
  cleanupTempDirs,
  makeManager,
  makeOrigin,
  provisionWorkspace,
  writeFiles,
} from './fixtures.ts'

const STAGE: StageRef = {
  stageId: '3f6f0f5e-0f1a-4a3a-9d3c-000000000002',
  role: 'implementer',
  provider: 'claude-code',
  attempt: 1,
}

afterAll(cleanupTempDirs)

describe('task diff range', () => {
  it('resolves the merge-base and tip of a provisioned task branch', async () => {
    const origin = await makeOrigin()
    const { manager } = await makeManager()
    const workspace = await provisionWorkspace(manager, {
      slug: 'diff-range',
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'main',
    })
    const git = new Git(manager.config)

    const range = await resolveTaskDiffRange(git, manager.config, {
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'main',
      slug: 'diff-range',
    })

    expect(range.base).toBe(await origin.head())
    expect(range.tip).toBe(await origin.head())
    expect(range.mirror).toBe(workspace.mirrorPath)
  })

  it('rejects a task whose branch was never provisioned', async () => {
    const origin = await makeOrigin()
    const { manager } = await makeManager()
    const git = new Git(manager.config)

    const range = resolveTaskDiffRange(git, manager.config, {
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'main',
      slug: 'never-provisioned',
    })

    await expect(range).rejects.toThrow(TaskBranchMissingError)
  })

  it('rejects a task branch that shares no history with its base', async () => {
    const origin = await makeOrigin()
    const { manager } = await makeManager()
    const git = new Git(manager.config)
    const workspace = await provisionWorkspace(manager, {
      slug: 'unrelated-history',
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
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
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'main',
      slug: 'unrelated-history',
    })

    await expect(range).rejects.toThrow(GitError)
  })

  it('serializes with a concurrent mirror-lock holder (regression)', async () => {
    const origin = await makeOrigin()
    const { manager } = await makeManager()
    const git = new Git(manager.config)
    await provisionWorkspace(manager, {
      slug: 'lock-order',
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'main',
    })

    const mirror = mirrorPath(manager.config, mirrorKey(origin.url))
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
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'main',
      slug: 'lock-order',
    }).then(() => order.push('diff:done'))

    await Promise.all([holder, reader])

    expect(order).toEqual(['holder:enter', 'holder:exit', 'diff:done'])
  })
})

describe('files changed', () => {
  it('keeps the full path when a file name contains a tab', async () => {
    const origin = await makeOrigin()
    const { manager } = await makeManager()
    const git = new Git(manager.config)
    const workspace = await provisionWorkspace(manager, {
      slug: 'tab-path',
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'main',
    })
    await writeFiles(workspace.path, { 'src/foo\tbar.ts': 'export const a = 1\n' })
    await manager.commitStage(workspace, STAGE)

    const range = await resolveTaskDiffRange(git, manager.config, {
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'main',
      slug: 'tab-path',
    })
    const files = await taskFilesChanged(git, range, workspace.changeDir)

    expect(files).toEqual(
      expect.arrayContaining([
        { path: 'src/foo\tbar.ts', status: 'added', additions: 1, deletions: 0 },
      ]),
    )
  })

  it('lists product-code files with status and line counts', async () => {
    const origin = await makeOrigin()
    const { manager } = await makeManager()
    const git = new Git(manager.config)
    const workspace = await provisionWorkspace(manager, {
      slug: 'has-commits',
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'main',
    })
    await writeFiles(workspace.path, {
      'src/new-file.ts': 'export const a = 1\n',
      'README.md': '# origin\nextra line\n',
    })
    await manager.commitStage(workspace, STAGE)

    const range = await resolveTaskDiffRange(git, manager.config, {
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
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

  it('returns an empty list before any product-code commit exists (AC-1035)', async () => {
    const origin = await makeOrigin()
    const { manager } = await makeManager()
    const git = new Git(manager.config)
    await provisionWorkspace(manager, {
      slug: 'no-commits',
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'main',
    })

    const range = await resolveTaskDiffRange(git, manager.config, {
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'main',
      slug: 'no-commits',
    })
    const files = await taskFilesChanged(git, range, 'openspec/changes/no-commits')

    expect(files).toEqual([])
  })

  it('withholds the change folder, which the documents surface reads instead (AC-1060)', async () => {
    const origin = await makeOrigin()
    const { manager } = await makeManager()
    const git = new Git(manager.config)
    const workspace = await provisionWorkspace(manager, {
      slug: 'change-only',
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'main',
    })
    await writeFiles(workspace.path, {
      [`${workspace.changeDir}/proposal.md`]: '# proposal\n',
      'src/kept.ts': 'export const kept = 1\n',
    })
    await manager.commitStage(workspace, STAGE)

    const range = await resolveTaskDiffRange(git, manager.config, {
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'main',
      slug: 'change-only',
    })
    const files = await taskFilesChanged(git, range, workspace.changeDir)

    expect(files.map((file) => file.path)).toEqual(['src/kept.ts'])
  })

  it('lists nothing for a task that has only written its own documents (AC-1060)', async () => {
    const origin = await makeOrigin()
    const { manager } = await makeManager()
    const git = new Git(manager.config)
    const workspace = await provisionWorkspace(manager, {
      slug: 'docs-only',
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'main',
    })
    await writeFiles(workspace.path, {
      [`${workspace.changeDir}/proposal.md`]: '# proposal\n',
    })
    await manager.commitStage(workspace, STAGE)

    const range = await resolveTaskDiffRange(git, manager.config, {
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'main',
      slug: 'docs-only',
    })

    expect(await taskFilesChanged(git, range, workspace.changeDir)).toEqual([])
  })

  it('marks a removed file with status "deleted"', async () => {
    const origin = await makeOrigin({
      'README.md': '# origin\n',
      'src/existing.ts': 'export const existing = 1\n',
    })
    const { manager } = await makeManager()
    const git = new Git(manager.config)
    const workspace = await provisionWorkspace(manager, {
      slug: 'deleted-file',
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'main',
    })
    await rm(join(workspace.path, 'src/existing.ts'))
    await manager.commitStage(workspace, STAGE)

    const range = await resolveTaskDiffRange(git, manager.config, {
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'main',
      slug: 'deleted-file',
    })
    const files = await taskFilesChanged(git, range, workspace.changeDir)

    expect(files).toEqual(
      expect.arrayContaining([
        { path: 'src/existing.ts', status: 'deleted', additions: 0, deletions: 1 },
      ]),
    )
  })

  it('marks a file whose type changed (regular file to symlink) with status "type-changed"', async () => {
    const origin = await makeOrigin({
      'README.md': '# origin\n',
      'src/target.ts': 'export const target = 1\n',
    })
    const { manager } = await makeManager()
    const git = new Git(manager.config)
    const workspace = await provisionWorkspace(manager, {
      slug: 'type-changed-file',
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'main',
    })
    await rm(join(workspace.path, 'src/target.ts'))
    await symlink('README.md', join(workspace.path, 'src/target.ts'))
    await manager.commitStage(workspace, STAGE)

    const range = await resolveTaskDiffRange(git, manager.config, {
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
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

describe('the file ceiling', () => {
  const diffFile = (path: string): DiffFile => ({
    path,
    status: 'added',
    additions: 1,
    deletions: 0,
  })

  const codeFiles = (count: number, prefix = 'node_modules') =>
    Array.from({ length: count }, (_, index) => diffFile(`${prefix}/pkg-${index}/index.js`))

  it('leaves a comparison under the ceiling exactly as it came', () => {
    const files = codeFiles(3)

    expect(capDiffFiles(files)).toEqual(files)
  })

  it('serves the ceiling and no more', () => {
    expect(capDiffFiles(codeFiles(MAX_DIFF_FILES + 500))).toHaveLength(MAX_DIFF_FILES)
  })

  it("cuts in the comparison's own order, so what is kept is its first files", () => {
    const kept = capDiffFiles(codeFiles(MAX_DIFF_FILES + 500))

    expect(kept[0]?.path).toBe('node_modules/pkg-0/index.js')
    expect(kept.at(-1)?.path).toBe(`node_modules/pkg-${MAX_DIFF_FILES - 1}/index.js`)
  })
})

describe('one file diff', () => {
  it('returns the unified diff for the requested path', async () => {
    const origin = await makeOrigin()
    const { manager } = await makeManager()
    const git = new Git(manager.config)
    const workspace = await provisionWorkspace(manager, {
      slug: 'one-file',
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'main',
    })
    await writeFiles(workspace.path, { 'src/thing.ts': 'export const thing = 2\n' })
    await manager.commitStage(workspace, STAGE)

    const range = await resolveTaskDiffRange(git, manager.config, {
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'main',
      slug: 'one-file',
    })
    const diff = await taskFileDiff(git, range, 'src/thing.ts')

    expect(diff).toContain('+export const thing = 2')
  })

  it('rejects a directory-shaped path instead of returning every file (regression)', async () => {
    const origin = await makeOrigin()
    const { manager } = await makeManager()
    const git = new Git(manager.config)
    const workspace = await provisionWorkspace(manager, {
      slug: 'directory-path',
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'main',
    })
    await writeFiles(workspace.path, {
      'src/one.ts': 'export const one = 1\n',
      'src/two.ts': 'export const two = 2\n',
    })
    await manager.commitStage(workspace, STAGE)

    const range = await resolveTaskDiffRange(git, manager.config, {
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'main',
      slug: 'directory-path',
    })

    // `.`, `src`, and `src/` all still match every file under them even with
    // `:(literal)` — git's directory-prefix matching, not glob magic.
    for (const path of ['.', 'src', 'src/']) {
      expect(await taskFileDiff(git, range, path)).toBe('')
    }
  })

  it("returns a change-folder path's diff rather than refusing it (AC-1061)", async () => {
    const origin = await makeOrigin()
    const { manager } = await makeManager()
    const git = new Git(manager.config)
    const workspace = await provisionWorkspace(manager, {
      slug: 'exclude-change-dir',
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'main',
    })
    await writeFiles(workspace.path, {
      'openspec/changes/exclude-change-dir/proposal.md': '# proposal\n',
    })
    await manager.commitStage(workspace, STAGE)

    const range = await resolveTaskDiffRange(git, manager.config, {
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'main',
      slug: 'exclude-change-dir',
    })
    const diff = await taskFileDiff(git, range, 'openspec/changes/exclude-change-dir/proposal.md')

    expect(diff).toContain('+# proposal')
  })
})

describe('a task whose workspace has been released (AC-1037)', () => {
  it('reads the same diff after the worktree is removed', async () => {
    const origin = await makeOrigin()
    const { manager } = await makeManager()
    const git = new Git(manager.config)
    const workspace = await provisionWorkspace(manager, {
      slug: 'released',
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'main',
    })
    await writeFiles(workspace.path, { 'src/kept.ts': 'export const kept = true\n' })
    await manager.commitStage(workspace, STAGE)

    const before = await taskFilesChanged(
      git,
      await resolveTaskDiffRange(git, manager.config, {
        repoUrl: origin.url,
        mirrorKey: mirrorKey(origin.url),
        baseBranch: 'main',
        slug: 'released',
      }),
      workspace.changeDir,
    )

    await manager.release('released', mirrorKey(origin.url))

    const after = await taskFilesChanged(
      git,
      await resolveTaskDiffRange(git, manager.config, {
        repoUrl: origin.url,
        mirrorKey: mirrorKey(origin.url),
        baseBranch: 'main',
        slug: 'released',
      }),
      workspace.changeDir,
    )

    expect(after).toEqual(before)
  })
})

describe('one file diff context width', () => {
  const lines = Array.from({ length: 60 }, (_, index) => `line ${index + 1}`)
  const original = `${lines.join('\n')}\n`

  /** Context lines carry git's single leading space; added and removed do not. */
  const contextLines = (diff: string) =>
    diff.split('\n').filter((line) => line.startsWith(' ')).length

  async function editedLongFile(slug: string) {
    const origin = await makeOrigin({ 'long.txt': original })
    const { manager } = await makeManager()
    const git = new Git(manager.config)
    const workspace = await provisionWorkspace(manager, {
      slug,
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'main',
    })

    const edited = [...lines]
    edited[29] = 'line 30 edited'
    await writeFiles(workspace.path, { 'long.txt': `${edited.join('\n')}\n` })
    await manager.commitStage(workspace, STAGE)

    const range = await resolveTaskDiffRange(git, manager.config, {
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'main',
      slug,
    })

    return { git, range }
  }

  it("defaults to git's own three lines either side", async () => {
    const { git, range } = await editedLongFile('context-default')

    expect(contextLines(await taskFileDiff(git, range, 'long.txt'))).toBe(6)
  })

  it('widens the hunk when a width is asked for (AC-1063)', async () => {
    const { git, range } = await editedLongFile('context-wider')
    const diff = await taskFileDiff(git, range, 'long.txt', 10)

    expect(contextLines(diff)).toBe(20)
    expect(diff).toContain(' line 20')
  })

  it('serves the ceiling rather than refusing a width past it', async () => {
    const { git, range } = await editedLongFile('context-ceiling')
    const diff = await taskFileDiff(git, range, 'long.txt', MAX_DIFF_CONTEXT + 5_000)

    expect(contextLines(diff)).toBe(lines.length - 1)
  })

  it('returns the whole file when the width passes its length', async () => {
    const { git, range } = await editedLongFile('context-whole-file')
    const diff = await taskFileDiff(git, range, 'long.txt', 500)

    expect(contextLines(diff)).toBe(lines.length - 1)
    expect(diff).toContain(' line 1\n')
    expect(diff).toContain(' line 60')
  })
})
