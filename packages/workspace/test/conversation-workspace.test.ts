import { afterAll, describe, expect, test } from 'bun:test'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Git, InvalidConversationWorkspaceKeyError, type StageRef } from '../src/index.ts'
import { cleanupTempDirs, makeManager, makeOrigin, writeFiles } from './fixtures.ts'

const STAGE: StageRef = {
  stageId: '3f6f0f5e-0f1a-4a3a-9d3c-000000000009',
  role: 'researcher',
  provider: 'claude-code',
  attempt: 0,
}

afterAll(cleanupTempDirs)

async function exists(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null)) !== null
}

describe('conversation workspaces', () => {
  test('start and restart from a clean task snapshot without prior response scratch', async () => {
    const origin = await makeOrigin({ 'src/app.ts': 'export const a = 1\n' })
    const { manager } = await makeManager()
    const primary = await manager.provision({
      slug: 'conversation-snapshot',
      repoUrl: origin.url,
      baseBranch: 'main',
    })
    await manager.commitStage(primary, STAGE)
    await writeFiles(primary.path, {
      '.specmate/old/CONVERSATION.json': '{"message":"a previous response"}\n',
      '.specmate/old/prompt.md': 'a previous prompt\n',
    })

    const conversation = await manager.provisionConversation(primary, 'response-0')
    await writeFiles(conversation.path, {
      '.specmate/response-0/CONVERSATION.json': '{"message":"interrupted response"}\n',
    })
    const restarted = await manager.provisionConversation(primary, 'response-0')
    const git = new Git(manager.config)
    const branch = await git.run(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: restarted.path })
    const status = await git.run(['status', '--porcelain=v1'], { cwd: restarted.path })

    expect(restarted.kind).toBe('conversation')
    expect(restarted.path).toBe(conversation.path)
    expect(restarted.path).not.toBe(primary.path)
    expect(branch.stdout.trim()).toBe('HEAD')
    expect(status.stdout.trim()).toBe('')
    expect(await exists(join(restarted.path, '.specmate'))).toBe(false)
    await manager.releaseConversation(primary.slug, primary.repoUrl, restarted.key)
  })

  test('destroying a snapshot removes response edits and commits without moving the task branch', async () => {
    const origin = await makeOrigin({ 'src/app.ts': 'export const a = 1\n' })
    const { manager } = await makeManager()
    const primary = await manager.provision({
      slug: 'conversation-disposal',
      repoUrl: origin.url,
      baseBranch: 'main',
    })
    await manager.commitStage(primary, STAGE)
    const git = new Git(manager.config)
    const before = (await git.run(['rev-parse', 'HEAD'], { cwd: primary.path })).stdout.trim()
    const conversation = await manager.provisionConversation(primary, 'response-1')

    await writeFiles(conversation.path, {
      'src/app.ts': 'export const a = 99\n',
      '.specmate/response-1/CONVERSATION.json': '{"message":"temporary response"}\n',
    })
    await git.run(['add', '-A'], { cwd: conversation.path })
    await git.run(['commit', '--quiet', '-m', 'temporary response commit'], {
      cwd: conversation.path,
    })
    const detachedCommit = (
      await git.run(['rev-parse', 'HEAD'], { cwd: conversation.path })
    ).stdout.trim()

    expect(detachedCommit).not.toBe(before)
    expect((await git.run(['rev-parse', 'HEAD'], { cwd: primary.path })).stdout.trim()).toBe(before)
    expect(await readFile(join(primary.path, 'src/app.ts'), 'utf8')).toBe('export const a = 1\n')

    await manager.releaseConversation(primary.slug, primary.repoUrl, conversation.key)
    await manager.releaseConversation(primary.slug, primary.repoUrl, conversation.key)

    expect(await exists(conversation.path)).toBe(false)
    expect(
      (await git.inMirror(primary.mirrorPath, ['worktree', 'list', '--porcelain'])).stdout,
    ).not.toContain(conversation.path)
    expect((await git.run(['rev-parse', 'HEAD'], { cwd: primary.path })).stdout.trim()).toBe(before)
    expect((await git.run(['status', '--porcelain=v1'], { cwd: primary.path })).stdout.trim()).toBe(
      '',
    )
  })

  test('rejects keys that could escape the conversation workspace root', async () => {
    const origin = await makeOrigin()
    const { manager } = await makeManager()
    const primary = await manager.provision({
      slug: 'conversation-key',
      repoUrl: origin.url,
      baseBranch: 'main',
    })

    for (const key of ['../outside', '..', '.']) {
      await expect(manager.provisionConversation(primary, key)).rejects.toBeInstanceOf(
        InvalidConversationWorkspaceKeyError,
      )
    }
  })
})
