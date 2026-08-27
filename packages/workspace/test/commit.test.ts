import { afterAll, describe, expect, test } from 'bun:test'
import { stat } from 'node:fs/promises'
import { Git, mirrorKey, type StageRef } from '../src/index.ts'
import { cleanupTempDirs, makeManager, makeOrigin, writeFiles } from './fixtures.ts'

const STAGE: StageRef = {
  stageId: '3f6f0f5e-0f1a-4a3a-9d3c-000000000002',
  role: 'spec_writer',
  provider: 'codex',
  attempt: 2,
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
  const count = async () => {
    const log = await git.run(['rev-list', '--count', 'HEAD'], { cwd: workspace.path })
    return Number(log.stdout.trim())
  }
  return { origin, manager, workspace, git, count }
}

describe('stage commits', () => {
  test('carry the task, stage, role, provider and attempt', async () => {
    const { manager, workspace, git } = await setup('trailers')
    await writeFiles(workspace.path, { 'openspec/changes/trailers/proposal.md': '# draft\n' })

    const outcome = await manager.commitStage(workspace, STAGE)

    expect(outcome.committed).toBe(true)
    const subject = await git.run(['log', '-1', '--format=%s'], { cwd: workspace.path })
    expect(subject.stdout.trim()).toBe('chore(trailers): spec_writer stage output')
    const trailers = await git.run(['log', '-1', '--format=%(trailers:only=true)'], {
      cwd: workspace.path,
    })
    expect(trailers.stdout).toContain('Task: trailers')
    expect(trailers.stdout).toContain(`Stage: ${STAGE.stageId}`)
    expect(trailers.stdout).toContain('Role: spec_writer')
    expect(trailers.stdout).toContain('Provider: codex')
    expect(trailers.stdout).toContain('Attempt: 2')
    if (outcome.committed) {
      expect(outcome.files).toContain('openspec/changes/trailers/proposal.md')
    }
  })

  test('report a stage that changed nothing without committing', async () => {
    const { manager, workspace, count } = await setup('idle')
    // The scaffolded marker is the only untracked file; commit it first so the
    // tree is genuinely clean.
    await manager.commitStage(workspace, STAGE)
    const before = await count()

    const outcome = await manager.commitStage(workspace, STAGE)

    expect(outcome.committed).toBe(false)
    expect(await count()).toBe(before)
  })

  test('are not duplicated when a crash replays the commit', async () => {
    const { manager, workspace, count } = await setup('replay')
    await writeFiles(workspace.path, { 'openspec/changes/replay/proposal.md': '# draft\n' })

    const first = await manager.commitStage(workspace, STAGE)
    const after = await count()
    const second = await manager.commitStage(workspace, STAGE)

    expect(first.committed).toBe(true)
    expect(second.committed).toBe(false)
    expect(await count()).toBe(after)
  })
})

describe('release', () => {
  test('removes the working tree and keeps the branch', async () => {
    const { manager, workspace, git } = await setup('done')
    await writeFiles(workspace.path, { 'openspec/changes/done/summary.md': '# shipped\n' })
    const outcome = await manager.commitStage(workspace, STAGE)

    await manager.release(workspace.slug, workspace.mirrorKey)

    expect(await stat(workspace.path).catch(() => null)).toBeNull()
    const branch = await git.inMirror(workspace.mirrorPath, ['rev-parse', 'task/done'])
    expect(branch.stdout.trim()).toBe(outcome.committed ? outcome.commit : 'unreachable')
  })

  test('is a no-op the second time', async () => {
    const { manager, workspace } = await setup('twice')

    await manager.release(workspace.slug, workspace.mirrorKey)
    await manager.release(workspace.slug, workspace.mirrorKey)

    expect(await stat(workspace.path).catch(() => null)).toBeNull()
  })
})
