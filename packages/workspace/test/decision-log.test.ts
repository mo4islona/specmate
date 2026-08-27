import { afterAll, describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Git, mirrorKey, type StageRef } from '../src/index.ts'
import { cleanupTempDirs, makeManager, makeOrigin } from './fixtures.ts'

const STAGE: StageRef = {
  stageId: '3f6f0f5e-0f1a-4a3a-9d3c-000000000003',
  role: 'researcher',
  provider: 'claude-code',
  attempt: 0,
}

afterAll(cleanupTempDirs)

async function setup(slug: string) {
  const origin = await makeOrigin()
  const { manager } = await makeManager()
  const workspace = await manager.provision({
    slug,
    repoUrl: origin.url,
    mirrorKey: mirrorKey(origin.url),
    baseBranch: 'main',
  })
  const git = new Git(manager.config)
  const logPath = join(workspace.path, workspace.changeDir, 'decisions.md')

  return { origin, manager, workspace, git, logPath }
}

describe('writeDecisionLog', () => {
  test('writes the rendered markdown into the change folder', async () => {
    const { manager, workspace, logPath } = await setup('decision-log')

    await manager.writeDecisionLog(workspace, '# Decisions\n\nNo decisions yet.\n')

    expect(await readFile(logPath, 'utf8')).toBe('# Decisions\n\nNo decisions yet.\n')
  })

  test('rides the stage’s own commit', async () => {
    const { manager, workspace, git, logPath } = await setup('decision-log-commit')

    await manager.writeDecisionLog(workspace, '# Decisions\n\nOne open question.\n')
    const outcome = await manager.commitStage(workspace, STAGE)

    expect(outcome.committed).toBe(true)
    if (outcome.committed)
      expect(outcome.files).toContain('openspec/changes/decision-log-commit/decisions.md')
    const committed = await git.run(
      ['show', `HEAD:openspec/changes/decision-log-commit/decisions.md`],
      { cwd: workspace.path },
    )
    expect(committed.stdout).toContain('One open question.')
    expect(await readFile(logPath, 'utf8')).toContain('One open question.')
  })

  test('a later write overwrites an edit left by an earlier stage, and that overwrite is what the next commit carries', async () => {
    const { manager, workspace, git, logPath } = await setup('decision-log-overwrite')

    await manager.writeDecisionLog(workspace, '# Decisions\n\nFirst render.\n')
    await manager.commitStage(workspace, STAGE)

    // A role scribbles into the log — nothing in the write-scope check stops
    // it, since the file lives inside the change folder.
    await Bun.write(logPath, '# an agent scribbled here\n')
    await manager.commitStage(workspace, { ...STAGE, attempt: 1 })
    const scribbled = await git.run(
      ['show', 'HEAD:openspec/changes/decision-log-overwrite/decisions.md'],
      { cwd: workspace.path },
    )
    expect(scribbled.stdout).toContain('scribbled')

    // The next stage's dispatch regenerates the log before it runs.
    await manager.writeDecisionLog(workspace, '# Decisions\n\nSecond render.\n')
    await manager.commitStage(workspace, { ...STAGE, attempt: 2 })

    const regenerated = await git.run(
      ['show', 'HEAD:openspec/changes/decision-log-overwrite/decisions.md'],
      { cwd: workspace.path },
    )
    expect(regenerated.stdout).not.toContain('scribbled')
    expect(regenerated.stdout).toContain('Second render.')
    expect(await readFile(logPath, 'utf8')).toBe('# Decisions\n\nSecond render.\n')
  })

  test('reproduces the log after the workspace is discarded and rebuilt', async () => {
    const { manager, workspace, logPath } = await setup('decision-log-rebuild')

    await manager.writeDecisionLog(workspace, '# Decisions\n\nBefore discard.\n')
    await manager.commitStage(workspace, STAGE)
    await manager.discard(workspace)

    // A discarded tree still has the last-committed log...
    expect(await readFile(logPath, 'utf8')).toContain('Before discard.')

    // ...and the orchestrator's next-dispatch write reproduces it fresh from
    // the store rather than leaving a stale or lost file.
    await manager.writeDecisionLog(workspace, '# Decisions\n\nAfter rebuild.\n')

    expect(await readFile(logPath, 'utf8')).toBe('# Decisions\n\nAfter rebuild.\n')
  })
})
