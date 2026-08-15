import { afterAll, describe, expect, test } from 'bun:test'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  BaseBranchMissingError,
  Git,
  type GitSpawn,
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
  test('gives a task its own working tree on its own branch', async () => {
    const origin = await makeOrigin()
    const { manager } = await makeManager()

    const workspace = await manager.provision({
      slug: 'fix-reorg',
      repoUrl: origin.url,
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

  test('keeps two tasks apart and leaves the base branch alone', async () => {
    const origin = await makeOrigin()
    const base = await origin.head()
    const { manager } = await makeManager()

    const a = await manager.provision({ slug: 'task-a', repoUrl: origin.url, baseBranch: 'main' })
    const b = await manager.provision({ slug: 'task-b', repoUrl: origin.url, baseBranch: 'main' })
    await writeFiles(a.path, { 'openspec/changes/task-a/proposal.md': '# a\n' })
    await manager.commitStage(a, STAGE)

    expect(a.path).not.toBe(b.path)
    expect(a.branch).not.toBe(b.branch)
    expect(a.mirrorPath).toBe(b.mirrorPath)
    expect(await origin.head()).toBe(base)
    expect(await headOf(manager, b.path)).toBe(base)
  })

  test('returns the same workspace on a second request, commits intact', async () => {
    const origin = await makeOrigin()
    const { manager } = await makeManager()
    const request = { slug: 'again', repoUrl: origin.url, baseBranch: 'main' }

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

  test('names the missing base branch instead of guessing another', async () => {
    const origin = await makeOrigin()
    const { manager } = await makeManager()

    const failure = manager.provision({
      slug: 'wrong-base',
      repoUrl: origin.url,
      baseBranch: 'develop',
    })

    await expect(failure).rejects.toThrow(BaseBranchMissingError)
    await expect(failure).rejects.toThrow(/develop/)
  })
})

describe('the shared local copy', () => {
  test('is reused by the next task rather than copied again', async () => {
    const origin = await makeOrigin()
    const { manager } = await makeManager()
    await manager.provision({ slug: 'first', repoUrl: origin.url, baseBranch: 'main' })

    const sentinel = join(mirrorPath(manager.config, origin.url), 'sentinel')
    await writeFile(sentinel, 'kept')
    await manager.provision({ slug: 'second', repoUrl: origin.url, baseBranch: 'main' })

    expect(await readFile(sentinel, 'utf8')).toBe('kept')
  })

  test('never appears half-made, and leftovers are swept', async () => {
    const origin = await makeOrigin()
    const { manager } = await makeManager()
    const mirror = mirrorPath(manager.config, origin.url)
    const abandoned = `${mirror}.tmp-dead`
    await mkdir(abandoned, { recursive: true })
    await writeFile(join(abandoned, 'junk'), 'half a clone')

    const workspace = await manager.provision({
      slug: 'after-crash',
      repoUrl: origin.url,
      baseBranch: 'main',
    })

    expect(await exists(abandoned)).toBe(false)
    expect(await exists(join(mirror, 'objects'))).toBe(true)
    expect(await headOf(manager, workspace.path)).toBe(await origin.head())
  })

  test('is made once when two tasks arrive before it exists', async () => {
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
      manager.provision({ slug: 'cold-a', repoUrl: origin.url, baseBranch: 'main' }),
      manager.provision({ slug: 'cold-b', repoUrl: origin.url, baseBranch: 'main' }),
    ])

    expect(clones).toBe(1)
    expect(a.mirrorPath).toBe(b.mirrorPath)
    expect(await headOf(manager, a.path)).toBe(await headOf(manager, b.path))
  })
})

describe('a task branch stands still', () => {
  test('later tasks start from the advanced base, earlier ones do not move', async () => {
    const origin = await makeOrigin()
    const { manager } = await makeManager()
    const early = await manager.provision({
      slug: 'early',
      repoUrl: origin.url,
      baseBranch: 'main',
    })
    const earlyHead = await headOf(manager, early.path)

    await origin.commit({ 'NEW.md': 'upstream moved\n' }, 'advance base')
    const later = await manager.provision({
      slug: 'later',
      repoUrl: origin.url,
      baseBranch: 'main',
    })
    const reprovisioned = await manager.provision({
      slug: 'early',
      repoUrl: origin.url,
      baseBranch: 'main',
    })

    expect(await headOf(manager, later.path)).toBe(await origin.head())
    expect(await headOf(manager, reprovisioned.path)).toBe(earlyHead)
  })
})

describe('repair', () => {
  test('recreates a working tree that was lost, keeping the branch', async () => {
    const origin = await makeOrigin()
    const { manager } = await makeManager()
    const request = { slug: 'lost-tree', repoUrl: origin.url, baseBranch: 'main' }
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

  test('restores a path that is no longer a checkout of the task branch', async () => {
    const origin = await makeOrigin()
    const { manager } = await makeManager()
    const request = { slug: 'broken-tree', repoUrl: origin.url, baseBranch: 'main' }
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
  test('keep runner leftovers out of git without touching the repository', async () => {
    const origin = await makeOrigin({ 'README.md': '# origin\n', '.gitignore': 'dist/\n' })
    const { manager } = await makeManager()
    const workspace = await manager.provision({
      slug: 'scratchy',
      repoUrl: origin.url,
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
})

describe('change folder scaffolding', () => {
  test('creates the folder with its schema marker and preserves existing artifacts', async () => {
    const origin = await makeOrigin()
    const { manager } = await makeManager()
    const request = { slug: 'scaffold', repoUrl: origin.url, baseBranch: 'main' }
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

  test('adds nothing else to a repository that does not use OpenSpec', async () => {
    const origin = await makeOrigin({ 'src/main.ts': 'export const a = 1\n' })
    const { manager } = await makeManager()
    const workspace = await manager.provision({
      slug: 'foreign',
      repoUrl: origin.url,
      baseBranch: 'main',
    })

    const status = await new Git(manager.config).run(['status', '--porcelain', '-uall'], {
      cwd: workspace.path,
    })

    expect(status.stdout.trim().split('\n')).toEqual(['?? openspec/changes/foreign/.openspec.yaml'])
  })
})
