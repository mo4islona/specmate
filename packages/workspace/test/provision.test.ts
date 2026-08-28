import { afterAll, describe, expect, it } from 'bun:test'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathExists } from '../src/fs.ts'
import {
  BaseBranchMissingError,
  DefaultBranchUnknownError,
  Git,
  type GitSpawn,
  mirrorKey,
  mirrorPath,
  resolveWorkspaceConfig,
  type StageRef,
  spawnGit,
  WorkspaceManager,
} from '../src/index.ts'
import {
  cleanupTempDirs,
  FAST_LOCKS,
  makeManager,
  makeOrigin,
  tempDir,
  writeFiles,
} from './fixtures.ts'

const STAGE: StageRef = {
  stageId: '3f6f0f5e-0f1a-4a3a-9d3c-000000000001',
  role: 'researcher',
  provider: 'claude-code',
  attempt: 1,
}

afterAll(cleanupTempDirs)

async function exists(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null)) !== null
}

async function headOf(manager: WorkspaceManager, path: string): Promise<string> {
  const result = await new Git(manager.config).run(['rev-parse', 'HEAD'], { cwd: path })
  return result.stdout.trim()
}

describe('provisioning', () => {
  it('gives a task its own working tree on its own branch', async () => {
    const origin = await makeOrigin()
    const { manager } = await makeManager()

    const workspace = await manager.provision({
      slug: 'fix-reorg',
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'main',
    })

    expect(workspace.branch).toBe('task/fix-reorg')
    expect(workspace.changeDir).toBe('openspec/changes/fix-reorg')
    expect(await readFile(join(workspace.path, 'README.md'), 'utf8')).toContain('origin')
    const branch = await new Git(manager.config).run(['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: workspace.path,
    })
    expect(branch.stdout.trim()).toBe('task/fix-reorg')
  })

  it('keeps two tasks apart and leaves the base branch alone', async () => {
    const origin = await makeOrigin()
    const base = await origin.head()
    const { manager } = await makeManager()

    const a = await manager.provision({
      slug: 'task-a',
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'main',
    })
    const b = await manager.provision({
      slug: 'task-b',
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'main',
    })
    await writeFiles(a.path, { 'openspec/changes/task-a/proposal.md': '# a\n' })
    await manager.commitStage(a, STAGE)

    expect(a.path).not.toBe(b.path)
    expect(a.branch).not.toBe(b.branch)
    expect(a.mirrorPath).toBe(b.mirrorPath)
    expect(await origin.head()).toBe(base)
    expect(await headOf(manager, b.path)).toBe(base)
  })

  it('returns the same workspace on a second request, commits intact', async () => {
    const origin = await makeOrigin()
    const { manager } = await makeManager()
    const request = {
      slug: 'again',
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'main',
    }

    const first = await manager.provision(request)
    await writeFiles(first.path, { 'openspec/changes/again/proposal.md': '# draft\n' })
    const commit = await manager.commitStage(first, STAGE)

    const second = await manager.provision(request)

    expect(second.path).toBe(first.path)
    expect(commit.committed).toBe(true)
    expect(await headOf(manager, second.path)).toBe(
      commit.committed ? commit.commit : 'unreachable',
    )
    expect(await readFile(join(second.path, 'openspec/changes/again/proposal.md'), 'utf8')).toBe(
      '# draft\n',
    )
  })

  it('names the missing base branch instead of guessing another', async () => {
    const origin = await makeOrigin()
    const { manager } = await makeManager()

    const failure = manager.provision({
      slug: 'wrong-base',
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'develop',
    })

    await expect(failure).rejects.toThrow(BaseBranchMissingError)
    await expect(failure).rejects.toThrow(/develop/)
  })

  it('cuts a task that named no base branch from the repository default — AC-737', async () => {
    const origin = await makeOrigin({ 'README.md': '# origin\n' }, 'master')
    const { manager } = await makeManager()

    const workspace = await manager.provision({
      slug: 'no-base',
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
    })

    expect(workspace.baseBranch).toBe('master')
    expect(await headOf(manager, workspace.path)).toBe(await origin.head('master'))
  })

  it('refuses to guess when the remote reports no default branch — AC-738', async () => {
    const empty = await tempDir('empty-origin')
    await new Git(resolveWorkspaceConfig({ root: empty })).run(['init', '--bare', '--quiet', empty])
    const { manager } = await makeManager()

    const repoUrl = `file://${empty}`
    const failure = manager.provision({
      slug: 'headless',
      repoUrl,
      mirrorKey: mirrorKey(repoUrl),
    })

    await expect(failure).rejects.toThrow(DefaultBranchUnknownError)
  })
})

describe('the shared local copy', () => {
  it('is reused by the next task rather than copied again', async () => {
    const origin = await makeOrigin()
    const { manager } = await makeManager()
    await manager.provision({
      slug: 'first',
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'main',
    })

    const sentinel = join(mirrorPath(manager.config, mirrorKey(origin.url)), 'sentinel')
    await writeFile(sentinel, 'kept')
    await manager.provision({
      slug: 'second',
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'main',
    })

    expect(await readFile(sentinel, 'utf8')).toBe('kept')
  })

  it('never appears half-made, and leftovers are swept', async () => {
    const origin = await makeOrigin()
    const { manager } = await makeManager()
    const mirror = mirrorPath(manager.config, mirrorKey(origin.url))
    const abandoned = `${mirror}.tmp-dead`
    await mkdir(abandoned, { recursive: true })
    await writeFile(join(abandoned, 'junk'), 'half a clone')

    const workspace = await manager.provision({
      slug: 'after-crash',
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'main',
    })

    expect(await exists(abandoned)).toBe(false)
    expect(await exists(join(mirror, 'objects'))).toBe(true)
    expect(await headOf(manager, workspace.path)).toBe(await origin.head())
  })

  it('is made once when two tasks arrive before it exists', async () => {
    const origin = await makeOrigin()
    const root = await tempDir('root')
    const options = { root, ...FAST_LOCKS }
    let clones = 0
    const spawn: GitSpawn = (spec) => {
      if (spec.cmd.includes('init') && spec.cmd.includes('--bare')) clones += 1
      return spawnGit(spec)
    }
    const manager = new WorkspaceManager({
      config: options,
      git: new Git(resolveWorkspaceConfig(options), spawn),
    })

    const [a, b] = await Promise.all([
      manager.provision({
        slug: 'cold-a',
        repoUrl: origin.url,
        mirrorKey: mirrorKey(origin.url),
        baseBranch: 'main',
      }),
      manager.provision({
        slug: 'cold-b',
        repoUrl: origin.url,
        mirrorKey: mirrorKey(origin.url),
        baseBranch: 'main',
      }),
    ])

    expect(clones).toBe(1)
    expect(a.mirrorPath).toBe(b.mirrorPath)
    expect(await headOf(manager, a.path)).toBe(await headOf(manager, b.path))
  })
})

describe('a task branch stands still', () => {
  it('later tasks start from the advanced base, earlier ones do not move', async () => {
    const origin = await makeOrigin()
    const { manager } = await makeManager()
    const early = await manager.provision({
      slug: 'early',
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'main',
    })
    const earlyHead = await headOf(manager, early.path)

    await origin.commit({ 'NEW.md': 'upstream moved\n' }, 'advance base')
    const later = await manager.provision({
      slug: 'later',
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'main',
    })
    const reprovisioned = await manager.provision({
      slug: 'early',
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'main',
    })

    expect(await headOf(manager, later.path)).toBe(await origin.head())
    expect(await headOf(manager, reprovisioned.path)).toBe(earlyHead)
  })
})

describe('repair', () => {
  it('recreates a working tree that was lost, keeping the branch', async () => {
    const origin = await makeOrigin()
    const { manager } = await makeManager()
    const request = {
      slug: 'lost-tree',
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'main',
    }
    const workspace = await manager.provision(request)
    await writeFiles(workspace.path, { 'openspec/changes/lost-tree/proposal.md': '# work\n' })
    await manager.commitStage(workspace, STAGE)
    const committed = await headOf(manager, workspace.path)

    await rm(workspace.path, { recursive: true, force: true })
    const repaired = await manager.provision(request)

    expect(await headOf(manager, repaired.path)).toBe(committed)
    expect(
      await readFile(join(repaired.path, 'openspec/changes/lost-tree/proposal.md'), 'utf8'),
    ).toBe('# work\n')
  })

  it('restores a path that is no longer a checkout of the task branch', async () => {
    const origin = await makeOrigin()
    const { manager } = await makeManager()
    const request = {
      slug: 'broken-tree',
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'main',
    }
    const workspace = await manager.provision(request)
    await writeFiles(workspace.path, { 'openspec/changes/broken-tree/proposal.md': '# work\n' })
    await manager.commitStage(workspace, STAGE)
    const committed = await headOf(manager, workspace.path)

    await rm(workspace.path, { recursive: true, force: true })
    await mkdir(workspace.path, { recursive: true })
    await writeFile(join(workspace.path, 'garbage'), 'not a checkout')
    const repaired = await manager.provision(request)

    expect(await headOf(manager, repaired.path)).toBe(committed)
    expect(await exists(join(repaired.path, 'garbage'))).toBe(false)
  })
})

describe('scratch exclusions', () => {
  it('keep runner leftovers out of git without touching the repository', async () => {
    const origin = await makeOrigin({ 'README.md': '# origin\n', '.gitignore': 'dist/\n' })
    const { manager } = await makeManager()
    const workspace = await manager.provision({
      slug: 'scratchy',
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'main',
    })

    await writeFile(join(workspace.path, 'RESULT.json'), '{"status":"ok"}')
    await writeFiles(workspace.path, {
      '.specmate/logs/stage.log': 'noise',
      'openspec/changes/scratchy/proposal.md': '# real work\n',
    })
    const outcome = await manager.commitStage(workspace, STAGE)
    const committedFiles = await new Git(manager.config).run(
      ['show', '--name-only', '--format=', 'HEAD'],
      { cwd: workspace.path },
    )

    expect(outcome.committed).toBe(true)
    expect(committedFiles.stdout).toContain('openspec/changes/scratchy/proposal.md')
    expect(committedFiles.stdout).not.toContain('RESULT.json')
    expect(committedFiles.stdout).not.toContain('.specmate')
    expect(await readFile(join(workspace.path, '.gitignore'), 'utf8')).toBe('dist/\n')
  })

  it('keeps out what only the runner produces, wherever the tree it lands in', async () => {
    // The target repository ignores none of this: pnpm relocating its store
    // beside the project, and a core dump, are things its authors never see.
    const origin = await makeOrigin({ 'README.md': '# origin\n' })
    const { manager } = await makeManager()
    const workspace = await manager.provision({
      slug: 'runner-leftovers',
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'main',
    })

    await writeFiles(workspace.path, {
      '.pnpm-store/v11/files/00/abcdef': 'a package',
      'node_modules/left-pad/index.js': 'module.exports = 1',
      'packages/core/node_modules/dep/index.js': 'module.exports = 2',
      'core.2387': 'a crash',
      'packages/core/src/chart.ts': 'export const chart = 1\n',
    })
    await manager.commitStage(workspace, STAGE)
    const committedFiles = await new Git(manager.config).run(
      ['show', '--name-only', '--format=', 'HEAD'],
      { cwd: workspace.path },
    )

    expect(committedFiles.stdout).toContain('packages/core/src/chart.ts')
    expect(committedFiles.stdout).not.toContain('.pnpm-store')
    expect(committedFiles.stdout).not.toContain('node_modules')
    expect(committedFiles.stdout).not.toContain('core.2387')
  })

  it('rewrites its own block rather than leaving a mirror on the list it was first given', async () => {
    const origin = await makeOrigin()
    const { manager } = await makeManager()
    const request = {
      slug: 'stale-excludes',
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'main',
    }
    const workspace = await manager.provision(request)
    const excludePath = join(workspace.mirrorPath, 'info', 'exclude')

    // What an older SpecMate wrote, under a marker with no end fence.
    await writeFile(
      excludePath,
      'dist/\n\n# specmate: runner scratch — never part of a stage commit\n/RESULT.json\n/.specmate/\n',
    )
    await manager.provision(request)
    const rewritten = await readFile(excludePath, 'utf8')

    expect(rewritten).toContain('.pnpm-store/')
    expect(rewritten.startsWith('dist/\n')).toBe(true)
    // One block, not two: the old one is replaced, so `/RESULT.json` is listed once.
    expect(rewritten.split('/RESULT.json')).toHaveLength(2)
  })
})

describe('change folder scaffolding', () => {
  it('creates the folder with its schema marker and preserves existing artifacts', async () => {
    const origin = await makeOrigin()
    const { manager } = await makeManager()
    const request = {
      slug: 'scaffold',
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'main',
    }
    const workspace = await manager.provision(request)

    const marker = join(workspace.path, 'openspec/changes/scaffold/.openspec.yaml')
    expect(await readFile(marker, 'utf8')).toContain('schema: spec-driven')

    await writeFiles(workspace.path, { 'openspec/changes/scaffold/proposal.md': '# kept\n' })
    await writeFile(marker, 'schema: custom\n')
    await manager.provision(request)

    expect(await readFile(marker, 'utf8')).toBe('schema: custom\n')
    expect(
      await readFile(join(workspace.path, 'openspec/changes/scaffold/proposal.md'), 'utf8'),
    ).toBe('# kept\n')
  })

  it('takes the name planning gave the change — AC-739', async () => {
    const origin = await makeOrigin()
    const { manager } = await makeManager()
    const workspace = await manager.provision({
      slug: 'named-task-a1b2c3d4',
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'main',
      changeName: 'pie-chart-axis-fade',
    })

    expect(workspace.changeDir).toBe('openspec/changes/pie-chart-axis-fade')
    expect(await pathExists(join(workspace.path, 'openspec/changes/named-task-a1b2c3d4'))).toBe(
      false,
    )
  })

  it('stands under the slug until planning has named it — AC-740', async () => {
    const origin = await makeOrigin()
    const { manager } = await makeManager()
    const workspace = await manager.provision({
      slug: 'unnamed-task',
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'main',
    })

    expect(workspace.changeDir).toBe('openspec/changes/unnamed-task')
  })

  it('moves the work with the folder rather than leaving it behind — AC-741', async () => {
    const origin = await makeOrigin()
    const { manager } = await makeManager()
    const request = {
      slug: 'moving-task',
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'main',
    }
    const workspace = await manager.provision(request)
    await writeFiles(workspace.path, { 'openspec/changes/moving-task/proposal.md': '# brief\n' })

    const renamed = await manager.renameChangeFolder(workspace, 'the-real-name')

    expect(renamed.changeDir).toBe('openspec/changes/the-real-name')
    expect(
      await readFile(join(workspace.path, 'openspec/changes/the-real-name/proposal.md'), 'utf8'),
    ).toBe('# brief\n')
    expect(await pathExists(join(workspace.path, 'openspec/changes/moving-task'))).toBe(false)
  })

  it('leaves a folder that is already in the history where it is — AC-741', async () => {
    const origin = await makeOrigin()
    const { manager } = await makeManager()
    const request = {
      slug: 'committed-task',
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'main',
    }
    const workspace = await manager.provision(request)
    await writeFiles(workspace.path, { 'openspec/changes/committed-task/proposal.md': '# brief\n' })
    await manager.commitStage(workspace, STAGE)

    const renamed = await manager.renameChangeFolder(workspace, 'too-late-to-rename')

    expect(renamed.changeDir).toBe('openspec/changes/committed-task')
  })

  it('does not write into a name the repository already uses — AC-742', async () => {
    const origin = await makeOrigin({
      'openspec/changes/pie-chart-axis-fade/proposal.md': '# somebody else\n',
    })
    const { manager } = await makeManager()
    const workspace = await manager.provision({
      slug: 'colliding-task-9f8e7d6c',
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'main',
    })

    const renamed = await manager.renameChangeFolder(workspace, 'pie-chart-axis-fade')

    expect(renamed.changeDir).toBe('openspec/changes/pie-chart-axis-fade-9f8e7d6c')
    expect(
      await readFile(
        join(workspace.path, 'openspec/changes/pie-chart-axis-fade/proposal.md'),
        'utf8',
      ),
    ).toBe('# somebody else\n')
  })

  /**
   * The declaring run is allowed to write into the folder it names (AC-243), so
   * that folder can already exist by the time this runs. Reading it as a
   * collision suffixes the destination away from the artifacts sitting in it,
   * and `git add -A` then commits both — the task going on to call the one
   * holding nothing but the schema marker its own.
   */
  it('AC-741: merges a folder the run created under the name it declared', async () => {
    const origin = await makeOrigin()
    const { manager } = await makeManager()
    const workspace = await manager.provision({
      slug: 'self-naming-task-1a2b3c4d',
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'main',
    })
    await writeFiles(workspace.path, {
      'openspec/changes/stale-lease-retry/proposal.md': '# the real work\n',
    })

    const renamed = await manager.renameChangeFolder(workspace, 'stale-lease-retry')

    expect(renamed.changeDir).toBe('openspec/changes/stale-lease-retry')
    expect(
      await readFile(
        join(workspace.path, 'openspec/changes/stale-lease-retry/proposal.md'),
        'utf8',
      ),
    ).toBe('# the real work\n')
    // The scaffolding follows the work rather than being left behind as a
    // second folder for the pipeline to advance on.
    expect(
      await pathExists(join(workspace.path, 'openspec/changes/stale-lease-retry/.openspec.yaml')),
    ).toBe(true)
    expect(
      await pathExists(join(workspace.path, 'openspec/changes/self-naming-task-1a2b3c4d')),
    ).toBe(false)
  })

  it('adds nothing else to a repository that does not use OpenSpec', async () => {
    const origin = await makeOrigin({ 'src/main.ts': 'export const a = 1\n' })
    const { manager } = await makeManager()
    const workspace = await manager.provision({
      slug: 'foreign',
      repoUrl: origin.url,
      mirrorKey: mirrorKey(origin.url),
      baseBranch: 'main',
    })

    const status = await new Git(manager.config).run(['status', '--porcelain', '-uall'], {
      cwd: workspace.path,
    })

    expect(status.stdout.trim().split('\n')).toEqual(['?? openspec/changes/foreign/.openspec.yaml'])
  })
})
