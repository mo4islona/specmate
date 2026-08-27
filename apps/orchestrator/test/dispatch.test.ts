import { describe, expect, it, test } from 'bun:test'
import { FEATURE_BUGFIX_PIPELINE, instantiateDefinition, type StageNode } from '@specmate/core'
import type { ConversationMessage, Task } from '@specmate/db'
import type {
  ConversationExecution,
  ConversationExecutor,
  ConversationRequest,
  StageExecution,
  StageExecutor,
  StageRequest,
} from '@specmate/runner'
import type { ConversationWorkspace, Workspace } from '@specmate/workspace'
import { mirrorKey } from '@specmate/workspace'
import { createConversationDispatcher, createStageDispatcher } from '../src/dispatch.ts'
import type { ConversationDispatch, StageDispatch } from '../src/engine.ts'

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
  mirrorKey: mirrorKey('https://github.com/owner/repo'),
  branch: 'specmate/a-task',
  baseBranch: 'release-4',
  path: '/workspaces/tasks/a-task',
  changeDir: 'openspec/changes/a-task',
  mirrorPath: '/workspaces/mirrors/repo.git',
} satisfies Workspace

const TASK = {
  id: '280336c6-b02c-497a-a083-d3403b95fd07',
  // Deliberately all different: a dispatcher reading the wrong one is then visible.
  modelBindings: {
    planner: { model: 'claude-opus-5', reasoningEffort: 'max' },
    implementer: { model: 'claude-sonnet-5', reasoningEffort: 'low' },
    answerer: { model: 'claude-haiku-4-5-20251001', reasoningEffort: 'medium' },
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
    signal: new AbortController().signal,
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

  it('carries the stop handle that ends the run’s retry loop', async () => {
    const abort = new AbortController()

    expect((await dispatched({ signal: abort.signal })).signal).toBe(abort.signal)
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

const CONVERSATION_WORKSPACE = {
  ...WORKSPACE,
  kind: 'conversation',
  key: 'c-1',
  sourceBranch: 'specmate/a-task',
} satisfies ConversationWorkspace

const OWNER_MESSAGE = {
  id: '11111111-1111-4111-8111-111111111111',
  contentMd: 'Why did the specification drop the retry?',
} as unknown as ConversationMessage

const RESPONSE = {
  id: '22222222-2222-4222-8222-222222222222',
  contentMd: '',
} as unknown as ConversationMessage

function conversationDispatchOf(): ConversationDispatch {
  return {
    task: TASK,
    conversationId: '33333333-3333-4333-8333-333333333333',
    response: RESPONSE,
    ownerMessage: OWNER_MESSAGE,
    context: 'the diff as it stands',
    previousAnchorCommit: 'aaaaaaa',
    previousTaskState: 'implement',
    currentAnchorCommit: 'bbbbbbb',
    currentTaskState: 'validate',
    contextPath: 'reconstructed',
    actionOptions: [],
    attempt: 2,
    provider: 'claude-code',
    startedAt: new Date('2026-08-24T11:20:09.000Z'),
    workspace: CONVERSATION_WORKSPACE,
  }
}

async function conversationDispatched(): Promise<ConversationRequest> {
  const requests: ConversationRequest[] = []
  const executor = {
    execute: async (request: ConversationRequest) => {
      requests.push(request)

      return {} as ConversationExecution
    },
  } as unknown as ConversationExecutor

  const dispatcher = createConversationDispatcher({
    executor,
    pinnedEnvironment: async () => ENVIRONMENT,
  })

  await dispatcher(conversationDispatchOf())
  const [request] = requests
  if (!request) throw new Error('the dispatcher ran nothing')

  return request
}

describe('the conversation dispatcher', () => {
  /**
   * The two halves of a turn are both messages and are one transposition apart:
   * the answer is written into the response's row, and what to answer is the
   * owner's text. Swapping them type-checks and answers the wrong question.
   */
  test('answers the owner’s message into the response’s row', async () => {
    const request = await conversationDispatched()

    expect(request.responseId).toBe(RESPONSE.id)
    expect(request.message).toBe(OWNER_MESSAGE.contentMd)
  })

  test('runs on the answerer’s binding — a turn has no node to take a role from', async () => {
    const request = await conversationDispatched()

    expect(request.model).toBe('claude-haiku-4-5-20251001')
    expect(request.reasoningEffort).toBe('medium')
  })

  test('branches from the workspace it was given, not the task’s own base', async () => {
    const request = await conversationDispatched()

    // The task row's base branch is nullable and is not what this tree was cut from.
    expect(request.baseBranch).toBe('release-4')
    expect(request.workspace).toBe(CONVERSATION_WORKSPACE)
  })

  test('carries the anchors and the path the context was assembled by', async () => {
    expect(await conversationDispatched()).toMatchObject({
      taskId: TASK.id,
      conversationId: '33333333-3333-4333-8333-333333333333',
      context: 'the diff as it stands',
      previousAnchorCommit: 'aaaaaaa',
      previousTaskState: 'implement',
      currentAnchorCommit: 'bbbbbbb',
      currentTaskState: 'validate',
      contextPath: 'reconstructed',
      provider: 'claude-code',
      attempt: 2,
      environment: ENVIRONMENT,
    })
  })
})
