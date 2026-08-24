import { describe, expect, test } from 'bun:test'
import { FEATURE_BUGFIX_PIPELINE, instantiateDefinition, type StageNode } from '@specmate/core'
import type { Task } from '@specmate/db'
import type { StageExecution, StageExecutor, StageRequest } from '@specmate/runner'
import type { Workspace } from '@specmate/workspace'
import { createStageDispatcher } from '../src/dispatch.ts'
import type { StageDispatch } from '../src/engine.ts'

/**
 * The one edge nothing used to cross: the engine's dispatch reaching the executor's
 * request. It was the entry point's own closure, so no test could call it, and the
 * day it stopped forwarding a field the whole suite still passed.
 *
 * Every field it must carry is required on `StageRequest`, so dropping one now fails
 * the type check. What is left for this test is the half types cannot see: that each
 * one is read from the right place.
 */
const DAG = instantiateDefinition(FEATURE_BUGFIX_PIPELINE)

const ENVIRONMENT = { image: 'ghcr.io/specmate/runner@sha256:abc', toolchains: [] }

const WORKSPACE = {
  slug: 'a-task',
  repoUrl: 'https://github.com/owner/repo',
  branch: 'specmate/a-task',
  baseBranch: 'release-4',
  path: '/workspaces/tasks/a-task',
  changeDir: 'openspec/changes/a-task',
  mirrorPath: '/workspaces/mirrors/repo.git',
} satisfies Workspace

const TASK = {
  id: '280336c6-b02c-497a-a083-d3403b95fd07',
  modelBindings: {
    planner: { model: 'claude-opus-5', reasoningEffort: 'max' },
    implementer: { model: 'claude-sonnet-5', reasoningEffort: 'low' },
  },
} as unknown as Task

function specifyNode(): StageNode {
  const node = DAG.nodes.find((candidate) => candidate.key === 'specify')
  if (node?.kind !== 'stage') throw new Error('the pipeline no longer specifies')

  return node
}

function dispatchOf(overrides: Partial<StageDispatch> = {}): StageDispatch {
  return {
    task: TASK,
    graphId: '5fec2806-63af-43a9-b55a-291fe7f53207',
    dag: DAG,
    node: specifyNode(),
    stageId: '9a7c2d87-e27f-4ab3-9ed7-d331619ee29d',
    attempt: 1,
    provider: 'claude-code',
    workspace: WORKSPACE,
    resume: { node: 'planning', sessionId: 'sess-planning' },
    ...overrides,
  }
}

/** Records the request rather than running anything; the mapping is the subject. */
function recordingExecutor() {
  const requests: StageRequest[] = []
  const executor = {
    execute: async (request: StageRequest) => {
      requests.push(request)

      return {} as StageExecution
    },
  } as unknown as StageExecutor

  return { executor, requests }
}

async function dispatched(overrides: Partial<StageDispatch> = {}): Promise<StageRequest> {
  const { executor, requests } = recordingExecutor()
  const dispatcher = createStageDispatcher({
    executor,
    pinnedEnvironment: async () => ENVIRONMENT,
  })

  await dispatcher(dispatchOf(overrides))
  const [request] = requests
  if (!request) throw new Error('the dispatcher ran nothing')

  return request
}

describe('the stage dispatcher', () => {
  test('carries the session the node it continues left behind', async () => {
    expect((await dispatched()).resume).toEqual({ node: 'planning', sessionId: 'sess-planning' })
  })

  test('carries a node that continues nothing as continuing nothing', async () => {
    expect((await dispatched({ resume: null })).resume).toBeNull()
  })

  test('resolves the model from the binding for this node’s role', async () => {
    const request = await dispatched()

    expect(request.model).toBe('claude-opus-5')
    expect(request.reasoningEffort).toBe('max')
  })

  test('runs on the environment pinned at provision, not the task snapshot', async () => {
    expect((await dispatched()).environment).toEqual(ENVIRONMENT)
  })

  test('passes the stage’s identity and the branch its workspace was cut from', async () => {
    const request = await dispatched()

    expect(request).toMatchObject({
      taskId: TASK.id,
      stageId: '9a7c2d87-e27f-4ab3-9ed7-d331619ee29d',
      node: 'specify',
      role: 'planner',
      provider: 'claude-code',
      attempt: 1,
      baseBranch: 'release-4',
    })
    expect(request.workspace).toBe(WORKSPACE)
  })
})
