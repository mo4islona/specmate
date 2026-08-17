import { afterAll, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Git, RESULT_FILE, SCRATCH_DIR, type StageRef } from '../src/index.ts'
import { cleanupTempDirs, makeManager, makeOrigin, writeFiles } from './fixtures.ts'

const STAGE: StageRef = {
  stageId: '3f6f0f5e-0f1a-4a3a-9d3c-000000000009',
  role: 'researcher',
  provider: 'claude-code',
  attempt: 1,
}

afterAll(cleanupTempDirs)

async function setup(slug: string) {
  const origin = await makeOrigin({
    'README.md': '# origin\n',
    'src/app.ts': 'export const a = 1\n',
  })
  const { manager } = await makeManager()
  const workspace = await manager.provision({ slug, repoUrl: origin.url, baseBranch: 'main' })
  const git = new Git(manager.config)
  await writeFiles(workspace.path, {
    [`openspec/changes/${slug}/proposal.md`]: '# committed\n',
  })
  const committed = await manager.commitStage(workspace, STAGE)
  return { manager, workspace, git, committed }
}

describe('discard', () => {
  test('reverts modified artifacts and removes what the attempt created', async () => {
    const { manager, workspace } = await setup('half-written')
    await writeFiles(workspace.path, {
      'openspec/changes/half-written/proposal.md': '# half rewritten\n',
      'openspec/changes/half-written/design.md': '# never finished\n',
      'src/app.ts': 'export const a = 2\n',
    })

    await manager.discard(workspace)

    const proposal = join(workspace.path, 'openspec/changes/half-written/proposal.md')
    expect(await readFile(proposal, 'utf8')).toBe('# committed\n')
    expect(await readFile(join(workspace.path, 'src/app.ts'), 'utf8')).toBe('export const a = 1\n')
    const design = join(workspace.path, 'openspec/changes/half-written/design.md')
    expect(await stat(design).catch(() => null)).toBeNull()
  })

  test('leaves every commit on the task branch in place', async () => {
    const { manager, workspace, git, committed } = await setup('keeps-history')
    const before = await git.run(['rev-list', '--count', 'HEAD'], { cwd: workspace.path })

    await manager.discard(workspace)

    const after = await git.run(['rev-list', '--count', 'HEAD'], { cwd: workspace.path })
    expect(after.stdout.trim()).toBe(before.stdout.trim())
    const head = await git.run(['rev-parse', 'HEAD'], { cwd: workspace.path })
    expect(head.stdout.trim()).toBe(committed.committed ? committed.commit : 'unreachable')
  })

  test('keeps the failed attempt’s scratch, which is the evidence', async () => {
    const { manager, workspace } = await setup('keeps-scratch')
    await writeFiles(workspace.path, {
      [RESULT_FILE]: '{"schema_version":1}',
      [`${SCRATCH_DIR}/stage-1/run.log`]: 'provider said no\n',
    })

    await manager.discard(workspace)

    expect(await readFile(join(workspace.path, RESULT_FILE), 'utf8')).toBe('{"schema_version":1}')
    const log = join(workspace.path, SCRATCH_DIR, 'stage-1', 'run.log')
    expect(await readFile(log, 'utf8')).toBe('provider said no\n')
  })

  test('succeeds on an already clean tree', async () => {
    const { manager, workspace, git } = await setup('already-clean')

    await manager.discard(workspace)

    const status = await git.run(['status', '--porcelain=v1'], { cwd: workspace.path })
    expect(status.stdout.trim()).toBe('')
  })

  test('an interrupted attempt can reset an agent-created commit to its accepted anchor', async () => {
    const { manager, workspace, git, committed } = await setup('interrupted-commit')
    assert(committed.committed)
    await writeFiles(workspace.path, { 'src/app.ts': 'export const a = 99\n' })
    await git.run(['add', '-A'], { cwd: workspace.path })
    await git.run(['commit', '--quiet', '-m', 'unaccepted attempt commit'], {
      cwd: workspace.path,
    })
    await writeFiles(workspace.path, { 'src/partial.ts': 'export const partial = true\n' })

    await manager.discard(workspace, committed.commit)

    expect((await git.run(['rev-parse', 'HEAD'], { cwd: workspace.path })).stdout.trim()).toBe(
      committed.commit,
    )
    expect(await readFile(join(workspace.path, 'src/app.ts'), 'utf8')).toBe('export const a = 1\n')
    expect(await stat(join(workspace.path, 'src/partial.ts')).catch(() => null)).toBeNull()
  })
})
