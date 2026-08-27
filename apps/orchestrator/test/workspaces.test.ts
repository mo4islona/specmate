import { describe, expect, test } from 'bun:test'
import type { StageRef, Workspace, WorkspaceService } from '@specmate/workspace'
import { mirrorKey } from '@specmate/workspace'
import { createEngineWorkspaces } from '../src/workspaces.ts'

/**
 * The adapter production runs, checked here rather than copied into every test that
 * needs one. Its whole job is delegation, which is why it is worth pinning: a wrong
 * argument in a one-line forward reads exactly like a right one.
 */
const IMAGE = 'ghcr.io/specmate/runner@sha256:abc'

const WORKSPACE = {
  slug: 'a-task',
  repoUrl: 'https://github.com/owner/repo',
  mirrorKey: mirrorKey('https://github.com/owner/repo'),
  branch: 'specmate/a-task',
  baseBranch: 'release-4',
  path: '/workspaces/tasks/a-task',
  changeDir: 'openspec/changes/a-task',
  mirrorPath: '/workspaces/mirrors/repo.git',
} satisfies Workspace

function recordingService() {
  const calls: { method: string; args: unknown[] }[] = []
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args })

      return Promise.resolve(undefined)
    }

  const service = {
    provision: record('provision'),
    provisionConversation: record('provisionConversation'),
    releaseConversation: record('releaseConversation'),
    discard: record('discard'),
    headCommit: record('headCommit'),
    commitStage: record('commitStage'),
    writeDecisionLog: record('writeDecisionLog'),
    countSpecScenarios: record('countSpecScenarios'),
    release: record('release'),
  } as unknown as WorkspaceService

  return { service, calls }
}

describe('the engine’s workspace adapter', () => {
  test('joins the default image onto a provision, which names only the task', async () => {
    const { service, calls } = recordingService()

    await createEngineWorkspaces({ service, image: IMAGE }).provision({
      taskId: 't-1',
      slug: 'a-task',
      repoUrl: 'https://github.com/owner/repo',
    })

    expect(calls[0]?.args[0]).toEqual({
      taskId: 't-1',
      slug: 'a-task',
      repoUrl: 'https://github.com/owner/repo',
      image: IMAGE,
    })
  })

  /**
   * The engine passes a task and the service takes two loose strings out of it, in an
   * order nothing but this test enforces — and both of them are strings.
   */
  test('unpacks a task into the slug and the repository, in that order', async () => {
    const { service, calls } = recordingService()

    await createEngineWorkspaces({ service, image: IMAGE }).releaseConversation(
      { slug: 'a-task', repoUrl: 'https://github.com/owner/repo' },
      'c-1',
    )

    expect(calls[0]?.args).toEqual(['a-task', 'https://github.com/owner/repo', 'c-1'])
  })

  test('forwards a stage commit under the task it belongs to', async () => {
    const { service, calls } = recordingService()
    const stage = { stageId: 's-1', role: 'planner', provider: 'claude-code', attempt: 0 }

    await createEngineWorkspaces({ service, image: IMAGE }).commitStage(
      't-1',
      WORKSPACE,
      stage as StageRef,
    )

    expect(calls[0]?.args).toEqual(['t-1', WORKSPACE, stage])
  })

  test('carries the commit a discard rewinds to', async () => {
    const { service, calls } = recordingService()

    await createEngineWorkspaces({ service, image: IMAGE }).discard(WORKSPACE, 'abc1234')

    expect(calls[0]?.args).toEqual([WORKSPACE, 'abc1234'])
  })
})
