import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_MODEL_BINDINGS,
  instantiateDefinition,
  type ModelId,
  PIPELINE_CATALOG,
  type PinnedGraph,
  PROVIDER_MODELS,
  type ProviderId,
  type TaskState,
} from '@specmate/core'
import {
  artifacts,
  conversationActions,
  conversationMessages,
  conversations,
  coverageWaivers,
  createDb,
  type Database,
  decisions,
  events,
  feedback,
  findOrCreateRepository,
  getModelDefaults,
  iterations,
  pullRequests,
  runGraphs,
  stages,
  tasks,
  updateModelDefaults,
} from '@specmate/db'
import { Engine } from '@specmate/orchestrator/engine'
import { createTask as createOrchestratedTask } from '@specmate/orchestrator/store'
import {
  Git,
  mirrorKey,
  resolveWorkspaceConfig,
  taskBranch,
  WorkspaceManager,
  WorkspaceService,
} from '@specmate/workspace'
import { asc, eq, inArray } from 'drizzle-orm'
import { createApp, type WorkspaceDiffOperations } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'

/** Every task needs a repository record now (REQ-316); tests seed one the way a launch would. */
async function repositoryIdFor(db: Database, repoUrl: string): Promise<string> {
  const repository = await findOrCreateRepository(db, { repoUrl, mirrorKey: mirrorKey(repoUrl) })

  return repository.id
}

/** No nodes on purpose: a comment on this task has no node to pin itself to. */
const EMPTY_DAG = {
  pipeline: 'feature-bugfix',
  entry: 'planning',
  terminal: 'archived',
  nodes: [],
} satisfies PinnedGraph

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

function createEngine(db: Database): Engine {
  return new Engine({
    db,
    workspaces: {
      provision: () => Promise.reject(new Error('API tests do not provision workspaces')),
      provisionConversation: () =>
        Promise.reject(new Error('API tests do not provision snapshots')),
      releaseConversation: () => Promise.resolve(),
      discard: () => Promise.reject(new Error('API tests do not discard workspaces')),
      release: () => Promise.resolve(),
    },
    settings: { stageConcurrency: 1, stageAttemptCap: 1, availableProviders: ['claude-code'] },
  })
}

const workspaceStub: WorkspaceDiffOperations = {
  diffFiles: () => Promise.reject(new Error('API tests do not read task diffs here')),
  diffFile: () => Promise.reject(new Error('API tests do not read task diffs here')),
  release: () => Promise.resolve(),
}

describeDb('api conversations', () => {
  let app: ReturnType<typeof createApp>
  let db: Database
  const createdTaskIds: string[] = []
  const auth = { authorization: 'Bearer test-password', 'content-type': 'application/json' }

  beforeAll(() => {
    db = createDb(url)
    app = createApp({
      db,
      gates: createEngine(db),
      workspace: workspaceStub,
      config: loadConfig({
        DATABASE_URL: url,
        NODE_ENV: 'test',
        SPECMATE_PASSWORD: 'test-password',
        WORKSPACE_ROOT: 'workspaces',
      }),
    })
  })

  afterAll(async () => {
    try {
      if (createdTaskIds.length > 0) {
        await db.delete(tasks).where(inArray(tasks.id, createdTaskIds))
      }
    } finally {
      await db.$client.close()
    }
  })

  async function createTask(status: 'specify' | 'archived' = 'specify'): Promise<string> {
    const [task] = await db
      .insert(tasks)
      .values({
        slug: `api-conversation-${crypto.randomUUID().slice(0, 8)}`,
        title: 'API conversation fixture',
        type: 'feature',
        repoUrl: 'https://github.com/example/api-conversation',
        repositoryId: await repositoryIdFor(db, 'https://github.com/example/api-conversation'),
        status,
      })
      .returning()
    assert(task)
    createdTaskIds.push(task.id)

    return task.id
  }

  it('health and authenticated task routes keep their structured boundary', async () => {
    expect((await app.request('/healthz')).status).toBe(200)
    const missing = await app.request('/api/v1/tasks')
    expect(missing.status).toBe(401)
    expect(await missing.json()).toMatchObject({ code: 'unauthenticated' })
  })

  it('creates, posts to, and hydrates one ordered conversation', async () => {
    const taskId = await createTask()
    const created = await app.request(`/api/v1/tasks/${taskId}/conversations`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
    })
    expect(created.status).toBe(201)
    const { conversation } = (await created.json()) as { conversation: { id: string } }

    const posted = await app.request(
      `/api/v1/tasks/${taskId}/conversations/${conversation.id}/messages`,
      {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ message: 'What changed?', idempotencyKey: crypto.randomUUID() }),
      },
    )
    expect(posted.status).toBe(201)
    expect(await posted.json()).toMatchObject({
      message: { sequence: 1, role: 'owner', contentMd: 'What changed?' },
      response: { sequence: 2, role: 'assistant', status: 'queued' },
    })

    const hydrated = await app.request(`/api/v1/tasks/${taskId}/conversations/${conversation.id}`, {
      headers: auth,
    })
    expect(hydrated.status).toBe(200)
    expect(await hydrated.json()).toMatchObject({
      conversation: { id: conversation.id },
      messages: [{ sequence: 1 }, { sequence: 2 }],
      actions: [],
    })
  })

  it('rejects empty messages and terminal posts without changing the transcript', async () => {
    const taskId = await createTask()
    const created = await app.request(`/api/v1/tasks/${taskId}/conversations`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
    })
    const { conversation } = (await created.json()) as { conversation: { id: string } }
    const empty = await app.request(
      `/api/v1/tasks/${taskId}/conversations/${conversation.id}/messages`,
      {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ message: ' ', idempotencyKey: crypto.randomUUID() }),
      },
    )
    expect(empty.status).toBe(400)
    expect(await empty.json()).toMatchObject({ code: 'validation' })

    await db
      .update(tasks)
      .set({ status: 'archived' })
      .where(inArray(tasks.id, [taskId]))
    const terminal = await app.request(
      `/api/v1/tasks/${taskId}/conversations/${conversation.id}/messages`,
      {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ message: 'Too late', idempotencyKey: crypto.randomUUID() }),
      },
    )
    expect(terminal.status).toBe(409)
    expect(await terminal.json()).toMatchObject({ code: 'conflict' })
  })

  it('replays the same conversation and message pair for a repeated idempotency key', async () => {
    const taskId = await createTask()
    const openKey = crypto.randomUUID()
    const first = await app.request(`/api/v1/tasks/${taskId}/conversations`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ idempotencyKey: openKey }),
    })
    const { conversation: firstConversation } = (await first.json()) as {
      conversation: { id: string }
    }

    const second = await app.request(`/api/v1/tasks/${taskId}/conversations`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ idempotencyKey: openKey }),
    })
    expect(second.status).toBe(201)
    const { conversation: secondConversation } = (await second.json()) as {
      conversation: { id: string }
    }
    expect(secondConversation.id).toBe(firstConversation.id)

    const messageKey = crypto.randomUUID()
    const firstMessage = await app.request(
      `/api/v1/tasks/${taskId}/conversations/${firstConversation.id}/messages`,
      {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ message: 'What changed?', idempotencyKey: messageKey }),
      },
    )
    const firstBody = (await firstMessage.json()) as { message: { id: string } }

    const secondMessage = await app.request(
      `/api/v1/tasks/${taskId}/conversations/${firstConversation.id}/messages`,
      {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ message: 'What changed?', idempotencyKey: messageKey }),
      },
    )
    expect(secondMessage.status).toBe(201)
    const secondBody = (await secondMessage.json()) as { message: { id: string } }
    expect(secondBody.message.id).toBe(firstBody.message.id)

    const hydrated = await app.request(
      `/api/v1/tasks/${taskId}/conversations/${firstConversation.id}`,
      { headers: auth },
    )
    expect(await hydrated.json()).toMatchObject({ messages: [{ sequence: 1 }, { sequence: 2 }] })
  })

  it('stops directly, blocks early restart, and idempotently stores restart guidance', async () => {
    const slug = `api-stop-${crypto.randomUUID().slice(0, 8)}`
    const { task, graph } = await createOrchestratedTask(db, {
      slug,
      title: 'API stop fixture',
      type: 'feature',
      repoUrl: 'https://github.com/example/api-stop',
      at: 'specify',
    })
    createdTaskIds.push(task.id)
    const [stage] = await db
      .insert(stages)
      .values({
        taskId: task.id,
        graphId: graph.id,
        nodeKey: 'specify',
        role: 'planner',
        provider: 'claude-code',
        status: 'running',
        attempt: 0,
        startedAt: new Date(),
      })
      .returning()
    assert(stage)

    const stopped = await app.request(`/api/v1/tasks/${task.id}/stages/stop`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        stageId: stage.id,
        graphId: graph.id,
        nodeKey: 'specify',
        attempt: 0,
      }),
    })
    expect(stopped.status).toBe(200)
    expect(await stopped.json()).toMatchObject({
      task: { status: 'paused', resumeStatus: 'specify' },
      stage: { status: 'interrupted', interruptionCleanupStatus: 'pending' },
    })

    const restartBody = {
      stageId: stage.id,
      guidance: 'Use the bounded variant.',
      idempotencyKey: `restart:${stage.id}`,
    }
    const early = await app.request(`/api/v1/tasks/${task.id}/stages/restart`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify(restartBody),
    })
    expect(early.status).toBe(409)

    await db
      .update(stages)
      .set({ interruptionCleanupStatus: 'succeeded' })
      .where(eq(stages.id, stage.id))
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const restarted = await app.request(`/api/v1/tasks/${task.id}/stages/restart`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify(restartBody),
      })
      expect(restarted.status).toBe(200)
    }
    expect(
      await db
        .select()
        .from(feedback)
        .where(eq(feedback.idempotencyKey, restartBody.idempotencyKey)),
    ).toHaveLength(1)
  })

  it('confirms only an action belonging to the addressed conversation', async () => {
    const taskId = await createTask()
    const [conversation] = await db.insert(conversations).values({ taskId }).returning()
    assert(conversation)
    const [message] = await db
      .insert(conversationMessages)
      .values({
        conversationId: conversation.id,
        sequence: 1,
        role: 'assistant',
        contentMd: 'I can carry that forward.',
        status: 'completed',
        taskState: 'specify',
      })
      .returning()
    assert(message)
    const [action] = await db
      .insert(conversationActions)
      .values({
        taskId,
        conversationId: conversation.id,
        messageId: message.id,
        kind: 'instruct_next_run',
        target: { taskId, nodeKey: 'implement' },
        instruction: 'Keep the migration bounded.',
        expectedVersion: { taskStatus: 'specify' },
      })
      .returning()
    assert(action)

    const wrong = await app.request(
      `/api/v1/tasks/${taskId}/conversations/${crypto.randomUUID()}/actions/${action.id}/confirm`,
      {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ idempotencyKey: `action:${action.id}` }),
      },
    )
    expect(wrong.status).toBe(404)

    const confirmed = await app.request(
      `/api/v1/tasks/${taskId}/conversations/${conversation.id}/actions/${action.id}/confirm`,
      {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ idempotencyKey: `action:${action.id}` }),
      },
    )
    expect(confirmed.status).toBe(200)
    expect(
      (await db.select().from(conversationActions).where(eq(conversationActions.id, action.id)))[0],
    ).toMatchObject({ status: 'applied' })
  })
})

describeDb('api', () => {
  let app: ReturnType<typeof createApp>
  let db: Database
  const createdTaskIds: string[] = []
  const auth = { authorization: 'Bearer test-password', 'content-type': 'application/json' }

  function createGateEngine(engineDb: Database): Engine {
    return new Engine({
      db: engineDb,
      workspaces: {
        provision: () => Promise.reject(new Error('API tests do not provision workspaces')),
        provisionConversation: () =>
          Promise.reject(new Error('API tests do not provision snapshots')),
        releaseConversation: () => Promise.resolve(),
        discard: () => Promise.reject(new Error('API tests do not discard workspaces')),
        release: () => Promise.resolve(),
      },
      settings: { stageConcurrency: 1, stageAttemptCap: 1, availableProviders: ['claude-code'] },
    })
  }

  beforeAll(() => {
    db = createDb(url)
    app = createApp({
      db,
      gates: createGateEngine(db),
      workspace: workspaceStub,
      config: loadConfig({
        DATABASE_URL: url,
        NODE_ENV: 'test',
        SPECMATE_PASSWORD: 'test-password',
        WORKSPACE_ROOT: 'workspaces',
      }),
      stream: { pollIntervalMs: 5, heartbeatIntervalMs: 0 },
    })
  })

  afterAll(async () => {
    try {
      if (createdTaskIds.length > 0) {
        await db.delete(tasks).where(inArray(tasks.id, createdTaskIds))
      }
    } finally {
      await db.$client.close()
    }
  })

  async function createDeletionTask(status: 'archived' | 'cancelled' | 'failed' | 'planning') {
    const [task] = await db
      .insert(tasks)
      .values({
        slug: `api-delete-${crypto.randomUUID().slice(0, 8)}`,
        title: `Delete ${status} fixture`,
        type: 'feature',
        repoUrl: 'https://github.com/example/api-delete',
        repositoryId: await repositoryIdFor(db, 'https://github.com/example/api-delete'),
        status,
      })
      .returning()
    assert(task)
    createdTaskIds.push(task.id)

    return task
  }

  function appWithRelease(release: WorkspaceDiffOperations['release']) {
    return createApp({
      db,
      gates: createGateEngine(db),
      workspace: { ...workspaceStub, release },
      config: loadConfig({
        DATABASE_URL: url,
        NODE_ENV: 'test',
        SPECMATE_PASSWORD: 'test-password',
        WORKSPACE_ROOT: 'workspaces',
      }),
    })
  }

  it('deletes an archived task and every subordinate record — AC-1081, AC-1084', async () => {
    const task = await createDeletionTask('archived')
    const [graph] = await db
      .insert(runGraphs)
      .values({ taskId: task.id, dag: EMPTY_DAG })
      .returning()
    assert(graph)
    const [stage] = await db
      .insert(stages)
      .values({
        taskId: task.id,
        graphId: graph.id,
        nodeKey: 'planning',
        role: 'planner',
        provider: 'claude-code',
        status: 'succeeded',
      })
      .returning()
    assert(stage)
    await db.insert(iterations).values({
      taskId: task.id,
      loop: 'spec',
      round: 1,
      reviewerVerdict: 'approve',
    })
    await db.insert(decisions).values({
      taskId: task.id,
      stageId: stage.id,
      nodeKey: 'planning',
      key: 'delete-fixture',
      kind: 'question',
      promptMd: 'Keep this?',
    })
    await db.insert(artifacts).values({
      taskId: task.id,
      path: 'openspec/changes/delete-fixture/proposal.md',
      kind: 'proposal',
    })
    await db.insert(pullRequests).values({
      taskId: task.id,
      url: `https://github.com/example/api-delete/pull/${crypto.randomUUID()}`,
    })
    await db.insert(feedback).values({
      taskId: task.id,
      stageId: stage.id,
      kind: 'comment',
      textMd: 'Delete fixture feedback',
    })
    await db.insert(events).values({
      taskId: task.id,
      stageId: stage.id,
      type: 'task.archived',
      payload: {},
    })
    const [conversation] = await db.insert(conversations).values({ taskId: task.id }).returning()
    assert(conversation)
    const [message] = await db
      .insert(conversationMessages)
      .values({
        conversationId: conversation.id,
        sequence: 1,
        role: 'assistant',
        contentMd: 'Deletion fixture',
        status: 'completed',
        stageId: stage.id,
        taskState: 'archived',
      })
      .returning()
    assert(message)
    await db.insert(conversationActions).values({
      taskId: task.id,
      conversationId: conversation.id,
      messageId: message.id,
      kind: 'instruct_next_run',
      target: { taskId: task.id, nodeKey: 'planning' },
      expectedVersion: { taskStatus: 'archived' },
    })

    const response = await app.request(`/api/v1/tasks/${task.id}`, {
      method: 'DELETE',
      headers: auth,
    })

    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    const subordinateRows = await Promise.all([
      db.select().from(runGraphs).where(eq(runGraphs.taskId, task.id)),
      db.select().from(stages).where(eq(stages.taskId, task.id)),
      db.select().from(iterations).where(eq(iterations.taskId, task.id)),
      db.select().from(decisions).where(eq(decisions.taskId, task.id)),
      db.select().from(artifacts).where(eq(artifacts.taskId, task.id)),
      db.select().from(pullRequests).where(eq(pullRequests.taskId, task.id)),
      db.select().from(feedback).where(eq(feedback.taskId, task.id)),
      db.select().from(events).where(eq(events.taskId, task.id)),
      db.select().from(conversations).where(eq(conversations.taskId, task.id)),
      db.select().from(conversationMessages).where(eq(conversationMessages.id, message.id)),
      db.select().from(conversationActions).where(eq(conversationActions.taskId, task.id)),
    ])
    expect(subordinateRows.every((rows) => rows.length === 0)).toBe(true)

    const detail = await app.request(`/api/v1/tasks/${task.id}`, { headers: auth })
    expect(detail.status).toBe(404)
    const listed = await app.request('/api/v1/tasks', { headers: auth })
    const body = (await listed.json()) as { tasks: { id: string }[] }
    expect(body.tasks.some((row) => row.id === task.id)).toBe(false)
  })

  it('also deletes a cancelled task — AC-1081', async () => {
    const task = await createDeletionTask('cancelled')

    const response = await app.request(`/api/v1/tasks/${task.id}`, {
      method: 'DELETE',
      headers: auth,
    })

    expect(response.status).toBe(204)
  })

  it('cancels a live task on the way out — AC-1082', async () => {
    const task = await createDeletionTask('planning')
    await db.insert(runGraphs).values({ taskId: task.id, dag: EMPTY_DAG })

    const response = await app.request(`/api/v1/tasks/${task.id}`, {
      method: 'DELETE',
      headers: auth,
    })

    expect(response.status).toBe(204)
    expect(await db.select().from(tasks).where(eq(tasks.id, task.id))).toHaveLength(0)
  })

  it('also deletes a failed task — AC-1082', async () => {
    const task = await createDeletionTask('failed')

    const response = await app.request(`/api/v1/tasks/${task.id}`, {
      method: 'DELETE',
      headers: auth,
    })

    expect(response.status).toBe(204)
    expect(await db.select().from(tasks).where(eq(tasks.id, task.id))).toHaveLength(0)
  })

  it('keeps the task when workspace release fails — AC-1083', async () => {
    const task = await createDeletionTask('archived')
    const releaseFailureApp = appWithRelease(() => Promise.reject(new Error('release failed')))

    const response = await releaseFailureApp.request(`/api/v1/tasks/${task.id}`, {
      method: 'DELETE',
      headers: auth,
    })

    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ code: 'internal' })
    expect(await db.select().from(tasks).where(eq(tasks.id, task.id))).toHaveLength(1)
  })

  it('renames a task, leaving its slug and its state alone', async () => {
    const task = await createDeletionTask('planning')

    const response = await app.request(`/api/v1/tasks/${task.id}`, {
      method: 'PATCH',
      headers: auth,
      body: JSON.stringify({ title: '  Rename the Y-axis column  ' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      task: { id: task.id, title: 'Rename the Y-axis column', slug: task.slug, status: 'planning' },
    })
    const [stored] = await db.select().from(tasks).where(eq(tasks.id, task.id))
    expect(stored?.title).toBe('Rename the Y-axis column')
  })

  it('refuses an empty rename and a rename of a task that is not there', async () => {
    const task = await createDeletionTask('archived')

    const empty = await app.request(`/api/v1/tasks/${task.id}`, {
      method: 'PATCH',
      headers: auth,
      body: JSON.stringify({ title: '   ' }),
    })
    expect(empty.status).toBe(400)
    expect(await empty.json()).toMatchObject({ code: 'validation' })

    const missing = await app.request(`/api/v1/tasks/${crypto.randomUUID()}`, {
      method: 'PATCH',
      headers: auth,
      body: JSON.stringify({ title: 'Nobody home' }),
    })
    expect(missing.status).toBe(404)
    expect((await db.select().from(tasks).where(eq(tasks.id, task.id)))[0]?.title).toBe(task.title)
  })

  it('launches on the request alone, deriving the name from it — AC-1001, AC-1056', async () => {
    const created = await app.request('/api/v1/tasks', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        description:
          'Fix the login redirect so it lands on the dashboard\n\nIt goes to the homepage today.',
        repoUrl: 'https://github.com/example/described-task',
      }),
    })
    expect(created.status).toBe(201)
    const body = (await created.json()) as {
      task: { id: string; title: string; slug: string; type: string; baseBranch: string | null }
    }
    createdTaskIds.push(body.task.id)

    expect(body.task.title).toBe('Fix the login redirect so it lands on the dashboard')
    expect(body.task.slug).toStartWith('fix-the-login-redirect')
    expect(body.task.type).toBe('feature')
    expect(body.task.baseBranch).toBeNull()
  })

  it('refuses a launch carrying no request — AC-1002', async () => {
    const titleOnly = await app.request('/api/v1/tasks', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        title: 'Title-only task fixture',
        type: 'unheard-of',
        repoUrl: 'https://github.com/example/title-only-task',
      }),
    })
    expect(titleOnly.status).toBe(400)
    expect(await titleOnly.json()).toMatchObject({
      code: 'validation',
      fields: { description: expect.any(Array), type: expect.any(Array) },
    })

    const blank = await app.request('/api/v1/tasks', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        description: '   ',
        repoUrl: 'https://github.com/example/blank-description-task',
      }),
    })
    expect(blank.status).toBe(400)
    expect(await blank.json()).toMatchObject({ code: 'validation' })
  })

  it('rejects a description under 20,000 characters that exceeds 20,000 bytes in UTF-8', async () => {
    const response = await app.request('/api/v1/tasks', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        title: 'Oversized non-Latin description fixture',
        description: '東'.repeat(10_000),
        type: 'bugfix',
        repoUrl: 'https://github.com/example/oversized-description-task',
      }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'validation' })
  })

  describe('the repository a launch resolves to — REQ-1016, REQ-1017', () => {
    const tag = crypto.randomUUID().slice(0, 8)
    const alpha = `https://github.com/example/alpha-${tag}`
    const beta = `https://github.com/example/beta-${tag}`
    const unused = `https://github.com/example/unused-${tag}`

    interface CreatedTask {
      task: { id: string; repoUrl: string }
    }

    async function launch(body: Record<string, unknown>): Promise<Response> {
      return app.request('/api/v1/tasks', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify(body),
      })
    }

    async function launched(response: Response): Promise<CreatedTask> {
      const body = (await response.json()) as CreatedTask
      createdTaskIds.push(body.task.id)

      return body
    }

    afterAll(async () => {
      await app.request('/api/v1/settings/default-repository', {
        method: 'PUT',
        headers: auth,
        body: JSON.stringify({ repoUrl: null }),
      })
    })

    it('a URL written in the request is the repository — AC-1047', async () => {
      const response = await launch({ description: `Fix the redirect in ${alpha}, it loops.` })
      expect(response.status).toBe(201)
      expect((await launched(response)).task.repoUrl).toBe(alpha)
    })

    it('a repository the system knows, named in the request — AC-1048', async () => {
      const response = await launch({ description: `Tidy the alpha-${tag} logging` })
      expect(response.status).toBe(201)
      expect((await launched(response)).task.repoUrl).toBe(alpha)
    })

    it('two known repositories named at once is a question — AC-1050', async () => {
      const seeded = await launch({ description: `Add a health check to ${beta}` })
      expect(seeded.status).toBe(201)
      await launched(seeded)

      const response = await launch({
        description: `Move alpha-${tag} onto the beta-${tag} pipeline`,
      })
      expect(response.status).toBe(400)
      const body = (await response.json()) as {
        fields: { repoUrl: string[] }
        candidates: string[]
      }
      expect(body.fields.repoUrl).toBeDefined()
      expect(body.candidates.sort()).toEqual([alpha, beta].sort())
    })

    it('nothing to resolve is a rejection carrying the candidates — AC-1049', async () => {
      const response = await launch({ description: 'Make the retry backoff configurable.' })

      expect(response.status).toBe(400)
      const body = (await response.json()) as { code: string; candidates: string[] }
      expect(body.code).toBe('validation')
      expect(body.candidates).toContain(alpha)
    })

    it('the list names what ran and what is default — AC-1051, AC-1053', async () => {
      const set = await app.request('/api/v1/settings/default-repository', {
        method: 'PUT',
        headers: auth,
        body: JSON.stringify({ repoUrl: unused }),
      })
      expect(set.status).toBe(200)

      const listed = await app.request('/api/v1/repositories', { headers: auth })
      const { repositories } = (await listed.json()) as {
        repositories: { repoUrl: string; taskCount: number; isDefault: boolean }[]
      }
      const names = repositories.map((row) => row.repoUrl)

      expect(names).toContain(alpha)
      expect(names.indexOf(beta)).toBeLessThan(names.indexOf(alpha))
      expect(repositories.find((row) => row.repoUrl === unused)).toMatchObject({
        taskCount: 0,
        isDefault: true,
      })
    })

    it('the default carries a request that names nothing — AC-1052', async () => {
      const response = await launch({ description: 'Make the retry backoff configurable.' })
      expect(response.status).toBe(201)
      expect((await launched(response)).task.repoUrl).toBe(unused)
    })

    it('a default that is not a repository URL is refused — AC-1054', async () => {
      const response = await app.request('/api/v1/settings/default-repository', {
        method: 'PUT',
        headers: auth,
        body: JSON.stringify({ repoUrl: 'not-a-repository' }),
      })
      expect(response.status).toBe(400)

      const current = await app.request('/api/v1/settings/default-repository', { headers: auth })
      expect(await current.json()).toEqual({ defaultRepository: unused })
    })
  })

  describe('spec conventions — REQ-923', () => {
    const repo = 'https://github.com/example/conventions-api'

    async function put(body: unknown) {
      return app.request('/api/v1/settings/spec-conventions', {
        method: 'PUT',
        headers: auth,
        body: JSON.stringify(body),
      })
    }

    async function stored() {
      const response = await app.request('/api/v1/settings/spec-conventions', { headers: auth })

      return (await response.json()) as {
        specConventions: Record<
          string,
          { profile: string; suitePath?: string; conventionNote?: string }
        >
      }
    }

    it('saves a convention and reads it back under the repository — AC-975, AC-976', async () => {
      const saved = await put({
        repoUrl: repo,
        repositoryId: await repositoryIdFor(db, repo),
        setting: { profile: 'custom', suitePath: 'docs/spec', conventionNote: 'One per service.' },
      })
      expect(saved.status).toBe(200)

      const { specConventions } = await stored()
      expect(specConventions['github.com/example/conventions-api']).toEqual({
        profile: 'custom',
        suitePath: 'docs/spec',
        conventionNote: 'One per service.',
      })
    })

    // AC-977: refused with something the screen can render, not a 500.
    it('refuses a configured suite with no location and changes nothing', async () => {
      await put({ repoUrl: repo, setting: { profile: 'openspec' } })

      const refused = await put({ repoUrl: repo, setting: { profile: 'custom' } })
      expect(refused.status).toBe(422)

      const { specConventions } = await stored()
      expect(specConventions['github.com/example/conventions-api']).toEqual({ profile: 'openspec' })
    })

    it('returns a repository to detection — AC-978', async () => {
      await put({ repoUrl: repo, setting: { profile: 'openspec' } })

      const removed = await put({ repoUrl: repo, setting: null })
      expect(removed.status).toBe(200)

      const { specConventions } = await stored()
      expect(specConventions['github.com/example/conventions-api']).toBeUndefined()
    })

    it('refuses a profile that is not one of the fixed set', async () => {
      const response = await put({ repoUrl: repo, setting: { profile: 'freeform' } })

      expect(response.status).toBe(400)
    })
  })

  describe('repositories and their coverage waivers — REQ-1015', () => {
    interface RepositoryJson {
      id: string
      repoUrl: string
      taskCount: number
      coverageWaiver: { originTaskId: string | null; originTitle: string | null } | null
    }

    const repoUrl = `https://example.invalid/waiver-${crypto.randomUUID().slice(0, 8)}.git`

    afterAll(async () => {
      await db.delete(coverageWaivers).where(eq(coverageWaivers.repoUrl, repoUrl))
    })

    it('lists repositories with the waiver in force, and revokes one — AC-1043, AC-1044', async () => {
      const created = await app.request('/api/v1/tasks', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({
          title: 'Waived repository fixture',
          description: 'Waived repository fixture request.',
          type: 'feature',
          repoUrl,
        }),
      })
      expect(created.status).toBe(201)
      const { task } = (await created.json()) as { task: { id: string } }
      createdTaskIds.push(task.id)

      await db.insert(coverageWaivers).values({
        repoUrl,
        repositoryId: await repositoryIdFor(db, repoUrl),
        originTaskId: task.id,
      })

      const listed = await app.request('/api/v1/repositories', { headers: auth })
      expect(listed.status).toBe(200)
      const body = (await listed.json()) as { repositories: RepositoryJson[] }
      const repository = body.repositories.find((row) => row.repoUrl === repoUrl)
      expect(repository?.coverageWaiver).toMatchObject({ originTaskId: task.id })
      assert(repository)

      const revoked = await app.request(`/api/v1/repositories/${repository.id}/coverage-waiver`, {
        method: 'DELETE',
        headers: auth,
      })
      expect(revoked.status).toBe(200)

      const after = await app.request('/api/v1/repositories', { headers: auth })
      const afterBody = (await after.json()) as { repositories: RepositoryJson[] }
      expect(afterBody.repositories.find((row) => row.repoUrl === repoUrl)?.coverageWaiver).toBe(
        null,
      )
    })

    it('revoking what a repository does not have is a structured not-found — AC-1045', async () => {
      const response = await app.request(
        `/api/v1/repositories/${crypto.randomUUID()}/coverage-waiver`,
        { method: 'DELETE', headers: auth },
      )

      expect(response.status).toBe(404)
      expect(await response.json()).toMatchObject({ code: 'not_found' })
    })
  })

  interface ModelBindingJson {
    provider: ProviderId
    model: string
    reasoningEffort: string
  }

  describe("an activity event's patch — REQ-1018", () => {
    const edit = {
      path: 'src/a.ts',
      additions: 2,
      deletions: 1,
      preview: '@@ -1,2 +1,3 @@\n-one\n+ONE\n+two',
      patch: '@@ -1,2 +1,3 @@\n-one\n+ONE\n+two\n context',
      truncated: true,
      anchored: true,
    }

    async function taskWithActivity(payload: Record<string, unknown>): Promise<{
      taskId: string
      seq: number
    }> {
      const [task] = await db
        .insert(tasks)
        .values({
          slug: `activity-${crypto.randomUUID().slice(0, 8)}`,
          title: 'Activity fixture',
          type: 'feature',
          repoUrl: 'https://github.com/example/activity-fixture',
          repositoryId: await repositoryIdFor(db, 'https://github.com/example/activity-fixture'),
        })
        .returning()
      if (!task) throw new Error('task insert returned no row')
      createdTaskIds.push(task.id)

      const [event] = await db
        .insert(events)
        .values({ taskId: task.id, type: 'stage.activity', payload })
        .returning()
      if (!event) throw new Error('event insert returned no row')

      return { taskId: task.id, seq: event.seq }
    }

    it('the timeline carries the preview and not the patch — AC-1057', async () => {
      const { taskId } = await taskWithActivity({
        attempt: 1,
        tool: 'Edit',
        target: 'src/a.ts',
        edit,
      })

      const response = await app.request(`/api/v1/tasks/${taskId}/events`, { headers: auth })
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        events: { payload: { edit?: Record<string, unknown> } }[]
      }
      const activity = body.events.at(-1)
      expect(activity?.payload.edit).toMatchObject({
        path: 'src/a.ts',
        additions: 2,
        deletions: 1,
        preview: edit.preview,
        truncated: true,
      })
      expect(activity?.payload.edit).not.toHaveProperty('patch')
    })

    it('one event answers with its whole patch — AC-1058', async () => {
      const { taskId, seq } = await taskWithActivity({
        attempt: 1,
        tool: 'Edit',
        target: 'src/a.ts',
        edit,
      })

      const response = await app.request(`/api/v1/tasks/${taskId}/events/${seq}/patch`, {
        headers: auth,
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ seq, patch: edit.patch })
    })

    it('an event that recorded no edit answers without one — AC-1059', async () => {
      const { taskId, seq } = await taskWithActivity({
        attempt: 1,
        tool: 'Bash',
        target: 'bun test',
      })

      const response = await app.request(`/api/v1/tasks/${taskId}/events/${seq}/patch`, {
        headers: auth,
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ seq, patch: null })
    })

    it("another task's event is not this task's to read", async () => {
      const { seq } = await taskWithActivity({ attempt: 1, tool: 'Edit', target: 'src/a.ts', edit })
      const { taskId: otherTaskId } = await taskWithActivity({
        attempt: 1,
        tool: 'Read',
        target: 'b',
      })

      const response = await app.request(`/api/v1/tasks/${otherTaskId}/events/${seq}/patch`, {
        headers: auth,
      })
      expect(response.status).toBe(404)
    })

    it('a cursor that is not a positive integer is rejected', async () => {
      const { taskId } = await taskWithActivity({ attempt: 1, tool: 'Read', target: 'b' })

      const response = await app.request(`/api/v1/tasks/${taskId}/events/nope/patch`, {
        headers: auth,
      })
      expect(response.status).toBe(400)
    })
  })

  describe('model defaults — REQ-1014, REQ-1001, REQ-917', () => {
    let originalDefaults: Awaited<ReturnType<typeof getModelDefaults>>

    beforeAll(async () => {
      originalDefaults = await getModelDefaults(db)
    })

    afterAll(async () => {
      await updateModelDefaults(db, originalDefaults)
    })

    it('reads the current default model and reasoning effort for every role — AC-1040', async () => {
      const response = await app.request('/api/v1/settings/model-defaults', { headers: auth })

      expect(response.status).toBe(200)
      const body = (await response.json()) as { modelDefaults: Record<string, ModelBindingJson> }
      expect(body.modelDefaults.researcher).toEqual(originalDefaults.researcher)
    })

    it('updates one role, a later read reflects it, and a task created afterward without an override for that role uses it — AC-1041', async () => {
      const updated = await app.request('/api/v1/settings/model-defaults', {
        method: 'PUT',
        headers: auth,
        body: JSON.stringify({ reviewer: { model: 'claude-sonnet-5' } }),
      })
      expect(updated.status).toBe(200)
      const updatedBody = (await updated.json()) as {
        modelDefaults: Record<string, ModelBindingJson>
      }
      expect(updatedBody.modelDefaults.reviewer?.model).toBe('claude-sonnet-5')

      const read = await app.request('/api/v1/settings/model-defaults', { headers: auth })
      const readBody = (await read.json()) as { modelDefaults: Record<string, ModelBindingJson> }
      expect(readBody.modelDefaults.reviewer?.model).toBe('claude-sonnet-5')

      const created = await app.request('/api/v1/tasks', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({
          title: 'Picks up updated default fixture',
          description: 'Picks up updated default fixture request.',
          type: 'bugfix',
          repoUrl: 'https://github.com/example/picks-up-updated-default',
        }),
      })
      expect(created.status).toBe(201)
      const createdBody = (await created.json()) as {
        task: { id: string; modelBindings: Record<string, ModelBindingJson> }
      }
      createdTaskIds.push(createdBody.task.id)
      expect(createdBody.task.modelBindings.reviewer?.model).toBe('claude-sonnet-5')
    })

    it("updates one role's reasoning effort only, leaving that role's model untouched — AC-1041", async () => {
      const modelBefore = (await getModelDefaults(db)).implementer.model
      const updated = await app.request('/api/v1/settings/model-defaults', {
        method: 'PUT',
        headers: auth,
        body: JSON.stringify({ implementer: { reasoningEffort: 'max' } }),
      })

      expect(updated.status).toBe(200)
      const body = (await updated.json()) as { modelDefaults: Record<string, ModelBindingJson> }
      expect(body.modelDefaults.implementer).toMatchObject({
        model: modelBefore,
        reasoningEffort: 'max',
      })
    })

    it('reports the providers this deployment runs alongside the defaults — REQ-917', async () => {
      const response = await app.request('/api/v1/settings/model-defaults', { headers: auth })

      const body = (await response.json()) as { availableProviders: string[] }
      expect(body.availableProviders).toEqual(['claude-code'])
    })

    // AC-1086: a provider and a model are wrong together rather than wrong alone.
    it('rejects an update pairing a provider with a model it cannot run — AC-1086', async () => {
      const before = await getModelDefaults(db)
      const rejected = await app.request('/api/v1/settings/model-defaults', {
        method: 'PUT',
        headers: auth,
        body: JSON.stringify({ implementer: { provider: 'codex', model: 'claude-opus-5' } }),
      })

      expect(rejected.status).toBe(400)
      expect(await getModelDefaults(db)).toEqual(before)
    })

    it('rejects an update naming a provider this deployment does not run — REQ-1014', async () => {
      const before = await getModelDefaults(db)
      const rejected = await app.request('/api/v1/settings/model-defaults', {
        method: 'PUT',
        headers: auth,
        body: JSON.stringify({ implementer: { provider: 'codex' } }),
      })

      expect(rejected.status).toBe(400)
      expect(await rejected.json()).toMatchObject({
        fields: { 'implementer.provider': expect.any(Array) },
      })
      expect(await getModelDefaults(db)).toEqual(before)
    })

    // AC-1085: naming a provider must not require naming a model in the same breath.
    it('launches with a provider override and no model, taking a model of that provider — AC-1085', async () => {
      const created = await app.request('/api/v1/tasks', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({
          title: 'Provider override fixture',
          description: 'Provider override fixture request.',
          type: 'bugfix',
          repoUrl: 'https://github.com/example/provider-override',
          modelBindings: { implementer: { provider: 'codex' } },
        }),
      })

      expect(created.status).toBe(201)
      const body = (await created.json()) as {
        task: { id: string; modelBindings: Record<string, ModelBindingJson> }
      }
      createdTaskIds.push(body.task.id)
      expect(body.task.modelBindings.implementer?.provider).toBe('codex')
      expect(PROVIDER_MODELS.codex).toContain(body.task.modelBindings.implementer?.model as ModelId)
      // Every other role keeps the current default, provider included.
      expect(body.task.modelBindings.reviewer?.provider).toBe('claude-code')
    })

    it('rejects a launch pairing a provider with a model it cannot run — AC-136', async () => {
      const rejected = await app.request('/api/v1/tasks', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({
          title: 'Incoherent override fixture',
          description: 'Incoherent override fixture request.',
          type: 'bugfix',
          repoUrl: 'https://github.com/example/incoherent-override',
          modelBindings: { implementer: { provider: 'codex', model: 'claude-opus-5' } },
        }),
      })

      expect(rejected.status).toBe(400)
      expect(await rejected.json()).toMatchObject({ code: 'validation' })
    })

    it('rejects an update naming a model outside the known catalog, leaving the stored default unchanged — AC-1042', async () => {
      const before = await getModelDefaults(db)
      const rejected = await app.request('/api/v1/settings/model-defaults', {
        method: 'PUT',
        headers: auth,
        body: JSON.stringify({ implementer: { model: 'gpt-99' } }),
      })

      expect(rejected.status).toBe(400)
      expect(await rejected.json()).toMatchObject({ code: 'validation' })
      const unchanged = await getModelDefaults(db)
      expect(unchanged.implementer).toEqual(before.implementer)
    })

    it('rejects an update naming a reasoning effort outside the known levels, leaving the stored default unchanged — AC-1042', async () => {
      const before = await getModelDefaults(db)
      const rejected = await app.request('/api/v1/settings/model-defaults', {
        method: 'PUT',
        headers: auth,
        body: JSON.stringify({ implementer: { reasoningEffort: 'ultra' } }),
      })

      expect(rejected.status).toBe(400)
      expect(await rejected.json()).toMatchObject({ code: 'validation' })
      const unchanged = await getModelDefaults(db)
      expect(unchanged.implementer).toEqual(before.implementer)
    })

    it('resetting sends the full shipped defaults and every role returns to them in one save — AC-949', async () => {
      await app.request('/api/v1/settings/model-defaults', {
        method: 'PUT',
        headers: auth,
        body: JSON.stringify({
          researcher: { model: 'claude-fable-5' },
          reviewer: { reasoningEffort: 'low' },
        }),
      })

      const reset = await app.request('/api/v1/settings/model-defaults', {
        method: 'PUT',
        headers: auth,
        body: JSON.stringify(DEFAULT_MODEL_BINDINGS),
      })

      expect(reset.status).toBe(200)
      const body = (await reset.json()) as { modelDefaults: Record<string, ModelBindingJson> }
      expect(body.modelDefaults).toEqual(DEFAULT_MODEL_BINDINGS)
    })

    it('launching with a model override reflects it for that role and current defaults elsewhere — AC-1038', async () => {
      const created = await app.request('/api/v1/tasks', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({
          title: 'Model override fixture',
          description: 'Model override fixture request.',
          type: 'bugfix',
          repoUrl: 'https://github.com/example/model-override',
          modelBindings: { implementer: { model: 'claude-fable-5' } },
        }),
      })
      expect(created.status).toBe(201)
      const body = (await created.json()) as {
        task: { id: string; modelBindings: Record<string, ModelBindingJson> }
      }
      createdTaskIds.push(body.task.id)
      expect(body.task.modelBindings.implementer?.model).toBe('claude-fable-5')
      const currentDefaults = await getModelDefaults(db)
      expect(body.task.modelBindings.researcher).toEqual(currentDefaults.researcher)
    })

    it('launching with a reasoning-effort-only override inherits the current default model for that role — AC-1038', async () => {
      const currentDefaults = await getModelDefaults(db)
      const created = await app.request('/api/v1/tasks', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({
          title: 'Effort override fixture',
          description: 'Effort override fixture request.',
          type: 'bugfix',
          repoUrl: 'https://github.com/example/effort-override',
          modelBindings: { implementer: { reasoningEffort: 'low' } },
        }),
      })
      expect(created.status).toBe(201)
      const body = (await created.json()) as {
        task: { id: string; modelBindings: Record<string, ModelBindingJson> }
      }
      createdTaskIds.push(body.task.id)
      expect(body.task.modelBindings.implementer).toMatchObject({
        provider: currentDefaults.implementer.provider,
        model: currentDefaults.implementer.model,
        reasoningEffort: 'low',
      })
    })

    it('rejects a task launched with a model override naming an unknown model, creating no task — AC-1039', async () => {
      const rejected = await app.request('/api/v1/tasks', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({
          title: 'Unknown model override fixture',
          description: 'Unknown model override fixture request.',
          type: 'bugfix',
          repoUrl: 'https://github.com/example/unknown-model-override',
          modelBindings: { implementer: { model: 'gpt-99' } },
        }),
      })

      expect(rejected.status).toBe(400)
      expect(await rejected.json()).toMatchObject({ code: 'validation' })
    })

    it('rejects a task launched with a reasoning-effort override naming an unknown level, creating no task — AC-1039', async () => {
      const rejected = await app.request('/api/v1/tasks', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({
          title: 'Unknown effort override fixture',
          description: 'Unknown effort override fixture request.',
          type: 'bugfix',
          repoUrl: 'https://github.com/example/unknown-effort-override',
          modelBindings: { implementer: { reasoningEffort: 'ultra' } },
        }),
      })

      expect(rejected.status).toBe(400)
      expect(await rejected.json()).toMatchObject({ code: 'validation' })
    })
  })

  it('task detail reports spend against budget, with cost marked incomplete rather than zero when telemetry is missing — REQ-1505, AC-1512, AC-1513', async () => {
    const { task, graph } = await createOrchestratedTask(db, {
      slug: `spend-${crypto.randomUUID().slice(0, 8)}`,
      title: 'Spend fixture',
      type: 'feature',
      repoUrl: 'https://github.com/example/spend-fixture',
      budgets: { max_cost_usd: 20 },
      at: 'specify',
    })
    createdTaskIds.push(task.id)
    const startedAt = new Date('2026-01-01T00:00:00Z')
    await db.insert(stages).values([
      {
        taskId: task.id,
        graphId: graph.id,
        nodeKey: 'planning',
        role: 'planner',
        provider: 'claude-code',
        status: 'succeeded',
        attempt: 1,
        startedAt,
        finishedAt: new Date(startedAt.getTime() + 60_000),
        cost: { costUsd: 2 },
      },
      {
        taskId: task.id,
        graphId: graph.id,
        nodeKey: 'specify',
        role: 'planner',
        provider: 'claude-code',
        status: 'succeeded',
        attempt: 1,
        startedAt,
        finishedAt: new Date(startedAt.getTime() + 120_000),
        cost: {},
      },
    ])

    const response = await app.request(`/api/v1/tasks/${task.id}`, { headers: auth })

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      spend: { costUsd: number; costComplete: boolean; agentMinutes: number }
    }
    expect(body.spend).toEqual({ costUsd: 2, costComplete: false, agentMinutes: 3 })
  })

  it('task detail carries the pull request the task opened, so the screen can link it', async () => {
    const { task } = await createOrchestratedTask(db, {
      slug: `pr-${crypto.randomUUID().slice(0, 8)}`,
      title: 'Pull request fixture',
      type: 'feature',
      repoUrl: 'https://github.com/example/pr-fixture',
      at: 'specify',
    })
    createdTaskIds.push(task.id)

    const before = await app.request(`/api/v1/tasks/${task.id}`, { headers: auth })
    expect(((await before.json()) as { pullRequest: unknown }).pullRequest).toBeNull()

    await db.insert(pullRequests).values({
      taskId: task.id,
      url: `https://github.com/example/pr-fixture/pull/${Math.floor(Math.random() * 100_000)}`,
      state: 'open',
      checksState: 'passing',
    })

    const response = await app.request(`/api/v1/tasks/${task.id}`, { headers: auth })
    const body = (await response.json()) as {
      pullRequest: { url: string; state: string; checksState: string | null } | null
    }

    expect(body.pullRequest).toMatchObject({ state: 'open', checksState: 'passing' })
    expect(body.pullRequest?.url).toMatch(/\/pull\/\d+$/)
  })

  it('aggregates gate, failure, and stall attention without healthy tasks', async () => {
    const rollback = new Error('rollback attention fixture')

    try {
      await db.transaction(async (tx) => {
        await tx.delete(tasks)

        const fixedNow = new Date('2026-08-16T12:00:00.000Z')
        const isolatedApp = createApp({
          db: tx as unknown as Database,
          gates: createGateEngine(tx as unknown as Database),
          workspace: workspaceStub,
          config: loadConfig({
            DATABASE_URL: url,
            NODE_ENV: 'test',
            SPECMATE_PASSWORD: 'test-password',
            SPECMATE_STALL_HOURS: '4',
            WORKSPACE_ROOT: 'workspaces',
          }),
          now: () => fixedNow,
        })
        const attentionAuth = { authorization: 'Bearer test-password' }

        const empty = await isolatedApp.request('/api/v1/attention', { headers: attentionAuth })
        expect(empty.status).toBe(200)
        expect(await empty.json()).toEqual({ items: [] })

        const seeded = await tx
          .insert(tasks)
          .values([
            {
              slug: 'attention-gate',
              title: 'Gate fixture',
              type: 'feature',
              repoUrl: 'https://github.com/example/gate-fixture',
              repositoryId: await repositoryIdFor(db, 'https://github.com/example/gate-fixture'),
              status: 'human_spec_gate',
              updatedAt: new Date('2026-08-16T11:00:00.000Z'),
            },
            {
              slug: 'attention-failed',
              title: 'Failure fixture',
              type: 'bugfix',
              repoUrl: 'https://github.com/example/failure-fixture',
              repositoryId: await repositoryIdFor(db, 'https://github.com/example/failure-fixture'),
              status: 'failed',
              updatedAt: new Date('2026-08-16T10:00:00.000Z'),
            },
            {
              slug: 'attention-vocabulary-failed',
              title: 'Vocabulary failure fixture',
              type: 'bugfix',
              repoUrl: 'https://github.com/example/vocabulary-fixture',
              repositoryId: await repositoryIdFor(
                db,
                'https://github.com/example/vocabulary-fixture',
              ),
              status: 'failed',
              updatedAt: new Date('2026-08-16T09:00:00.000Z'),
            },
            {
              slug: 'attention-stalled',
              title: 'Stall fixture',
              type: 'feature',
              repoUrl: 'https://github.com/example/stall-fixture',
              repositoryId: await repositoryIdFor(db, 'https://github.com/example/stall-fixture'),
              status: 'implement',
            },
            {
              slug: 'attention-healthy',
              title: 'Healthy fixture',
              type: 'bugfix',
              repoUrl: 'https://github.com/example/healthy-fixture',
              repositoryId: await repositoryIdFor(db, 'https://github.com/example/healthy-fixture'),
              status: 'specify',
            },
            {
              slug: 'attention-decision',
              title: 'Decision fixture',
              type: 'feature',
              repoUrl: 'https://github.com/example/decision-fixture',
              repositoryId: await repositoryIdFor(
                db,
                'https://github.com/example/decision-fixture',
              ),
              status: 'specify',
              updatedAt: new Date('2026-08-16T11:15:00.000Z'),
            },
            {
              slug: 'attention-parked-on-decision',
              title: 'Parked-on-decision fixture',
              type: 'feature',
              repoUrl: 'https://github.com/example/parked-decision-fixture',
              repositoryId: await repositoryIdFor(
                db,
                'https://github.com/example/parked-decision-fixture',
              ),
              status: 'waiting_human',
              updatedAt: new Date('2026-08-16T11:25:00.000Z'),
            },
            {
              // REQ-1201's invariant broken on purpose: waiting_human with no
              // open decision at all — the defect reportUnexplainedParks logs.
              slug: 'attention-orphan-waiting-human',
              title: 'Orphan waiting_human fixture',
              type: 'feature',
              repoUrl: 'https://github.com/example/orphan-fixture',
              repositoryId: await repositoryIdFor(db, 'https://github.com/example/orphan-fixture'),
              status: 'waiting_human',
              updatedAt: new Date('2026-08-16T11:35:00.000Z'),
            },
          ])
          .returning()
        const bySlug = new Map(seeded.map((task) => [task.slug, task]))
        const gateTask = bySlug.get('attention-gate')
        const failedTask = bySlug.get('attention-failed')
        const vocabularyFailedTask = bySlug.get('attention-vocabulary-failed')
        const stalledTask = bySlug.get('attention-stalled')
        const healthyTask = bySlug.get('attention-healthy')
        const decisionTask = bySlug.get('attention-decision')
        const parkedOnDecisionTask = bySlug.get('attention-parked-on-decision')
        const orphanWaitingHumanTask = bySlug.get('attention-orphan-waiting-human')
        if (
          !gateTask ||
          !failedTask ||
          !vocabularyFailedTask ||
          !stalledTask ||
          !healthyTask ||
          !decisionTask ||
          !parkedOnDecisionTask ||
          !orphanWaitingHumanTask
        ) {
          throw new Error('attention fixtures were not inserted')
        }
        await tx.insert(decisions).values([
          {
            taskId: decisionTask.id,
            nodeKey: 'specify',
            key: 'style-nit',
            kind: 'question',
            promptMd: 'Worth a follow-up task?',
            blocking: false,
            createdAt: new Date('2026-08-16T11:20:00.000Z'),
          },
          {
            taskId: parkedOnDecisionTask.id,
            nodeKey: 'specify',
            key: 'scope',
            kind: 'question',
            promptMd: 'Which repo does this cover?',
            blocking: true,
            createdAt: new Date('2026-08-16T11:25:00.000Z'),
          },
        ])

        await tx.insert(events).values([
          {
            taskId: gateTask.id,
            type: 'task.parked',
            payload: { gate: 'human_spec_gate' },
            createdAt: new Date('2026-08-16T11:00:00.000Z'),
          },
          {
            taskId: failedTask.id,
            type: 'task.failed',
            payload: { reason: 'attempt cap exhausted' },
            createdAt: new Date('2026-08-16T10:00:00.000Z'),
          },
          {
            taskId: vocabularyFailedTask.id,
            type: 'task.failed',
            payload: { reason: 'backend_error' },
            createdAt: new Date('2026-08-16T09:00:00.000Z'),
          },
          {
            taskId: stalledTask.id,
            type: 'stage.started',
            createdAt: new Date('2026-08-16T06:00:00.000Z'),
          },
          {
            taskId: healthyTask.id,
            type: 'stage.started',
            createdAt: new Date('2026-08-16T11:30:00.000Z'),
          },
          {
            taskId: gateTask.id,
            type: 'feedback.comment',
            payload: { comment: 'Still reviewing' },
            createdAt: new Date('2026-08-16T11:45:00.000Z'),
          },
          {
            taskId: failedTask.id,
            type: 'feedback.comment',
            payload: { comment: 'Investigating' },
            createdAt: new Date('2026-08-16T11:50:00.000Z'),
          },
        ])

        const response = await isolatedApp.request('/api/v1/attention', { headers: attentionAuth })
        expect(response.status).toBe(200)
        const body = (await response.json()) as {
          items: {
            task: { id: string }
            reason: { kind: string; detail: string }
            since: string
          }[]
        }
        expect(body.items).toHaveLength(7)
        expect(body.items.map((item) => item.reason.kind).sort()).toEqual([
          'decision',
          'decision',
          'failed',
          'failed',
          'gate',
          'gate',
          'stalled',
        ])
        expect(body.items.map((item) => item.task.id)).not.toContain(healthyTask.id)
        const gateItem = body.items.find((item) => item.task.id === gateTask.id)
        const failedItem = body.items.find((item) => item.task.id === failedTask.id)
        const decisionItem = body.items.find((item) => item.task.id === decisionTask.id)
        expect(gateItem?.since).toBe('2026-08-16T11:00:00.000Z')
        expect(failedItem?.since).toBe('2026-08-16T10:00:00.000Z')
        // Not in the vocabulary, so it keeps the words it spells.
        expect(failedItem?.reason.detail).toBe('attempt cap exhausted')
        // In it, so the operator reads the sentence rather than the identifier.
        // This is the first screen a task that could not be started reaches.
        const vocabularyFailedItem = body.items.find(
          (item) => item.task.id === vocabularyFailedTask.id,
        )
        expect(vocabularyFailedItem?.reason.detail).toBe(
          'The run could not be started: its image is missing on the host that must run it.',
        )
        expect(decisionItem?.since).toBe('2026-08-16T11:20:00.000Z')
        expect(decisionItem?.reason.detail).toBe('Worth a follow-up task?')

        // A waiting_human task carries no separate 'gate' item: its open
        // decision is the entire explanation, not a second redundant one.
        const parkedItems = body.items.filter((item) => item.task.id === parkedOnDecisionTask.id)
        expect(parkedItems).toHaveLength(1)
        expect(parkedItems[0]?.reason).toMatchObject({
          kind: 'decision',
          detail: 'Which repo does this cover?',
        })

        // The REQ-1201 invariant violation still fails open: the task shows
        // up rather than silently vanishing from the list.
        const orphanItems = body.items.filter((item) => item.task.id === orphanWaitingHumanTask.id)
        expect(orphanItems).toHaveLength(1)
        expect(orphanItems[0]?.reason).toMatchObject({ kind: 'gate' })
        expect(orphanItems[0]?.since).toBe('2026-08-16T11:35:00.000Z')

        throw rollback
      })
    } catch (error) {
      if (error !== rollback) {
        throw error
      }
    }
  })

  it('stage.activity does not reset the stall clock', async () => {
    const rollback = new Error('rollback activity-stall fixture')

    try {
      await db.transaction(async (tx) => {
        await tx.delete(tasks)

        const fixedNow = new Date('2026-08-16T12:00:00.000Z')
        const isolatedApp = createApp({
          db: tx as unknown as Database,
          gates: createGateEngine(tx as unknown as Database),
          config: loadConfig({
            DATABASE_URL: url,
            NODE_ENV: 'test',
            SPECMATE_PASSWORD: 'test-password',
            SPECMATE_STALL_HOURS: '4',
            WORKSPACE_ROOT: 'workspaces',
          }),
          workspace: workspaceStub,
          now: () => fixedNow,
        })
        const attentionAuth = { authorization: 'Bearer test-password' }

        const [loopingTask] = await tx
          .insert(tasks)
          .values({
            slug: 'attention-activity-loop',
            title: 'Looping stage fixture',
            type: 'feature',
            repoUrl: 'https://github.com/example/activity-loop-fixture',
            repositoryId: await repositoryIdFor(
              db,
              'https://github.com/example/activity-loop-fixture',
            ),
            status: 'implement',
          })
          .returning()
        if (!loopingTask) throw new Error('activity-stall fixture was not inserted')

        await tx.insert(events).values([
          {
            taskId: loopingTask.id,
            type: 'stage.started',
            createdAt: new Date('2026-08-16T06:00:00.000Z'),
          },
          // A stage stuck re-reading the same file every few seconds keeps
          // producing activity well past the stall cutoff — it must not
          // read as "recent activity" for stall purposes.
          {
            taskId: loopingTask.id,
            type: 'stage.activity',
            payload: { attempt: 0, tool: 'Read', target: 'a.ts' },
            createdAt: new Date('2026-08-16T11:59:00.000Z'),
          },
        ])

        const response = await isolatedApp.request('/api/v1/attention', { headers: attentionAuth })
        expect(response.status).toBe(200)
        const body = (await response.json()) as {
          items: { task: { id: string }; reason: { kind: string }; since: string }[]
        }
        const item = body.items.find((entry) => entry.task.id === loopingTask.id)
        expect(item?.reason.kind).toBe('stalled')
        expect(item?.since).toBe('2026-08-16T06:00:00.000Z')

        throw rollback
      })
    } catch (error) {
      if (error !== rollback) {
        throw error
      }
    }
  })

  it('requires bearer auth for streams and ignores query-string credentials', async () => {
    const missing = await app.request('/api/v1/events/stream')
    expect(missing.status).toBe(401)
    expect(await missing.json()).toMatchObject({
      code: 'unauthenticated',
      detail: expect.any(String),
    })

    const queryCredential = await app.request('/api/v1/events/stream?token=test-password')
    expect(queryCredential.status).toBe(401)
    expect(await queryCredential.json()).toMatchObject({
      code: 'unauthenticated',
      detail: expect.any(String),
    })
  })

  it('records task and stage-pinned comments with timeline events', async () => {
    const [task] = await db
      .insert(tasks)
      .values({
        slug: `comment-${crypto.randomUUID().slice(0, 8)}`,
        title: 'Comment fixture',
        type: 'feature',
        repoUrl: 'https://github.com/example/comment-fixture',
        repositoryId: await repositoryIdFor(db, 'https://github.com/example/comment-fixture'),
      })
      .returning()
    if (!task) throw new Error('task insert returned no row')
    createdTaskIds.push(task.id)

    const [graph] = await db
      .insert(runGraphs)
      .values({ taskId: task.id, dag: EMPTY_DAG })
      .returning()
    if (!graph) throw new Error('run graph insert returned no row')

    const [stage] = await db
      .insert(stages)
      .values({
        taskId: task.id,
        graphId: graph.id,
        nodeKey: 'review',
        role: 'reviewer',
        provider: 'codex',
        attempt: 1,
      })
      .returning()
    if (!stage) throw new Error('stage insert returned no row')

    const unpinned = await app.request(`/api/v1/tasks/${task.id}/feedback`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ comment: 'Whole-task observation' }),
    })
    expect(unpinned.status).toBe(201)

    const pinned = await app.request(`/api/v1/tasks/${task.id}/feedback`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ comment: 'Review observation', stageId: stage.id }),
    })
    expect(pinned.status).toBe(201)

    const feedbackRows = await db
      .select()
      .from(feedback)
      .where(eq(feedback.taskId, task.id))
      .orderBy(asc(feedback.createdAt))
    expect(feedbackRows).toHaveLength(2)
    expect(feedbackRows[0]).toMatchObject({
      stageId: null,
      role: null,
      provider: null,
      kind: 'comment',
      textMd: 'Whole-task observation',
    })
    expect(feedbackRows[1]).toMatchObject({
      stageId: stage.id,
      role: 'reviewer',
      provider: 'codex',
      kind: 'comment',
      textMd: 'Review observation',
    })

    const eventRows = await db
      .select()
      .from(events)
      .where(eq(events.taskId, task.id))
      .orderBy(asc(events.seq))
    expect(eventRows.map((event) => event.type)).toEqual(['feedback.comment', 'feedback.comment'])
    expect(eventRows[1]?.payload).toMatchObject({
      feedbackId: feedbackRows[1]?.id,
      stageId: stage.id,
      nodeKey: 'review',
    })

    const empty = await app.request(`/api/v1/tasks/${task.id}/feedback`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ comment: '   ' }),
    })
    expect(empty.status).toBe(400)
    expect(await empty.json()).toMatchObject({
      code: 'validation',
      fields: { comment: expect.any(Array) },
    })
  })

  it('an unpinned comment becomes guidance for the node the task stands on — AC-1046', async () => {
    const [task] = await db
      .insert(tasks)
      .values({
        slug: `guidance-${crypto.randomUUID().slice(0, 8)}`,
        title: 'Guidance fixture',
        type: 'feature',
        repoUrl: 'https://github.com/example/guidance-fixture',
        repositoryId: await repositoryIdFor(db, 'https://github.com/example/guidance-fixture'),
        status: 'implement',
      })
      .returning()
    if (!task) throw new Error('task insert returned no row')
    createdTaskIds.push(task.id)

    const [graph] = await db
      .insert(runGraphs)
      .values({
        taskId: task.id,
        dag: {
          pipeline: 'feature-bugfix',
          terminal: 'archived',
          entry: 'implement',
          nodes: [
            { kind: 'stage', key: 'implement', role: 'implementer', binding: 'role_default' },
            { kind: 'stage', key: 'validate', role: 'verifier', binding: 'role_default' },
          ],
        },
      })
      .returning()
    if (!graph) throw new Error('run graph insert returned no row')

    const [running] = await db
      .insert(stages)
      .values({
        taskId: task.id,
        graphId: graph.id,
        nodeKey: 'implement',
        role: 'implementer',
        provider: 'claude-code',
        status: 'running',
        attempt: 0,
      })
      .returning()
    if (!running) throw new Error('stage insert returned no row')

    const sent = await app.request(`/api/v1/tasks/${task.id}/feedback`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ comment: 'Keep the migration reversible.' }),
    })
    expect(sent.status).toBe(201)

    const [guidance] = await db.select().from(feedback).where(eq(feedback.taskId, task.id))
    expect(guidance).toMatchObject({
      kind: 'intervention',
      textMd: 'Keep the migration reversible.',
      target: { graphId: graph.id, nodeKey: 'implement' },
      consumedByStageId: null,
    })

    // The text has to come back into the thread it was typed into.
    const [event] = await db.select().from(events).where(eq(events.taskId, task.id))
    expect(event?.type).toBe('feedback.comment')
    expect(event?.payload).toMatchObject({ nodeKey: 'implement', guidance: true })
  })

  it('with nothing running, guidance addresses the node that runs next', async () => {
    const [task] = await db
      .insert(tasks)
      .values({
        slug: `next-node-${crypto.randomUUID().slice(0, 8)}`,
        title: 'Next node fixture',
        type: 'feature',
        repoUrl: 'https://github.com/example/next-node-fixture',
        repositoryId: await repositoryIdFor(db, 'https://github.com/example/next-node-fixture'),
        status: 'human_spec_gate',
      })
      .returning()
    if (!task) throw new Error('task insert returned no row')
    createdTaskIds.push(task.id)

    const [graph] = await db
      .insert(runGraphs)
      .values({
        taskId: task.id,
        dag: {
          pipeline: 'feature-bugfix',
          terminal: 'archived',
          entry: 'specify',
          nodes: [
            { kind: 'stage', key: 'specify', role: 'planner', binding: 'role_default' },
            { kind: 'gate', key: 'human_spec_gate', approve: 'implement', rework: ['specify'] },
            { kind: 'stage', key: 'implement', role: 'implementer', binding: 'role_default' },
          ],
        },
      })
      .returning()
    if (!graph) throw new Error('run graph insert returned no row')

    await db.insert(stages).values({
      taskId: task.id,
      graphId: graph.id,
      nodeKey: 'specify',
      role: 'planner',
      provider: 'claude-code',
      status: 'succeeded',
      attempt: 0,
    })

    const sent = await app.request(`/api/v1/tasks/${task.id}/feedback`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ comment: 'Watch the migration order.' }),
    })
    expect(sent.status).toBe(201)

    const [guidance] = await db.select().from(feedback).where(eq(feedback.taskId, task.id))
    expect(guidance).toMatchObject({
      kind: 'intervention',
      target: { graphId: graph.id, nodeKey: 'implement' },
    })
  })

  it('guidance on a paused task addresses the node it resumes into, not the one after', async () => {
    const [task] = await db
      .insert(tasks)
      .values({
        slug: `paused-guidance-${crypto.randomUUID().slice(0, 8)}`,
        title: 'Paused guidance fixture',
        type: 'feature',
        repoUrl: 'https://github.com/example/paused-guidance-fixture',
        repositoryId: await repositoryIdFor(
          db,
          'https://github.com/example/paused-guidance-fixture',
        ),
        status: 'paused',
        resumeStatus: 'implement',
      })
      .returning()
    if (!task) throw new Error('task insert returned no row')
    createdTaskIds.push(task.id)

    const [graph] = await db
      .insert(runGraphs)
      .values({
        taskId: task.id,
        dag: {
          pipeline: 'feature-bugfix',
          terminal: 'archived',
          entry: 'specify',
          nodes: [
            { kind: 'stage', key: 'specify', role: 'planner', binding: 'role_default' },
            { kind: 'stage', key: 'implement', role: 'implementer', binding: 'role_default' },
            { kind: 'stage', key: 'validate', role: 'validator', binding: 'cross_review' },
          ],
        },
      })
      .returning()
    if (!graph) throw new Error('run graph insert returned no row')

    // The interrupted attempt is what makes this case its own: `implement` has a row,
    // so a scan for the first node that never started steps over it and lands on
    // `validate` — a node no run will reach until this one finishes.
    await db.insert(stages).values([
      {
        taskId: task.id,
        graphId: graph.id,
        nodeKey: 'specify',
        role: 'planner',
        provider: 'claude-code',
        status: 'succeeded',
        attempt: 0,
      },
      {
        taskId: task.id,
        graphId: graph.id,
        nodeKey: 'implement',
        role: 'implementer',
        provider: 'claude-code',
        status: 'interrupted',
        attempt: 0,
      },
    ])

    const sent = await app.request(`/api/v1/tasks/${task.id}/feedback`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ comment: 'Continue where you left off.' }),
    })
    expect(sent.status).toBe(201)

    const [guidance] = await db.select().from(feedback).where(eq(feedback.taskId, task.id))
    expect(guidance).toMatchObject({
      kind: 'intervention',
      target: { graphId: graph.id, nodeKey: 'implement' },
    })
  })

  it('a finished task takes a note, not guidance no run will read', async () => {
    const [task] = await db
      .insert(tasks)
      .values({
        slug: `archived-${crypto.randomUUID().slice(0, 8)}`,
        title: 'Archived fixture',
        type: 'feature',
        repoUrl: 'https://github.com/example/archived-fixture',
        repositoryId: await repositoryIdFor(db, 'https://github.com/example/archived-fixture'),
        status: 'archived',
      })
      .returning()
    if (!task) throw new Error('task insert returned no row')
    createdTaskIds.push(task.id)

    await db.insert(runGraphs).values({
      taskId: task.id,
      dag: {
        pipeline: 'feature-bugfix',
        terminal: 'archived',
        entry: 'implement',
        nodes: [{ kind: 'stage', key: 'implement', role: 'implementer', binding: 'role_default' }],
      },
    })

    const sent = await app.request(`/api/v1/tasks/${task.id}/feedback`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ comment: 'For the record.' }),
    })
    expect(sent.status).toBe(201)

    const [note] = await db.select().from(feedback).where(eq(feedback.taskId, task.id))
    expect(note?.kind).toBe('comment')
    expect(note?.target).toBeNull()
  })

  it('delegates gate actions and rejects actions away from a gate', async () => {
    const dag = instantiateDefinition(PIPELINE_CATALOG.feature)

    async function seedAt(status: TaskState, label: string) {
      const [task] = await db
        .insert(tasks)
        .values({
          slug: `gate-${label}-${crypto.randomUUID().slice(0, 8)}`,
          title: `${label} gate fixture`,
          type: 'feature',
          repoUrl: `https://github.com/example/${label}-gate-fixture`,
          repositoryId: await repositoryIdFor(
            db,
            `https://github.com/example/${label}-gate-fixture`,
          ),
          status,
        })
        .returning()
      if (!task) throw new Error('gate task insert returned no row')
      createdTaskIds.push(task.id)
      await db.insert(runGraphs).values({ taskId: task.id, dag })

      return task
    }

    const approvedTask = await seedAt('human_kickoff_gate', 'approve')
    const approved = await app.request(`/api/v1/tasks/${approvedTask.id}/gates/approve`, {
      method: 'POST',
      headers: auth,
    })
    expect(approved.status).toBe(200)
    expect(await approved.json()).toMatchObject({ task: { status: 'specify' } })

    const redirectedTask = await seedAt('human_kickoff_gate', 'redirect')
    const emptyRedirect = await app.request(`/api/v1/tasks/${redirectedTask.id}/gates/redirect`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ comment: '   ' }),
    })
    expect(emptyRedirect.status).toBe(400)
    expect(await emptyRedirect.json()).toMatchObject({
      code: 'validation',
      fields: { comment: expect.any(Array) },
    })

    const redirected = await app.request(`/api/v1/tasks/${redirectedTask.id}/gates/redirect`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ comment: 'Clarify the scope before research' }),
    })
    expect(redirected.status).toBe(200)
    expect(await redirected.json()).toMatchObject({ task: { status: 'planning' } })

    const reworkedTask = await seedAt('human_spec_gate', 'rework')
    const emptyRework = await app.request(`/api/v1/tasks/${reworkedTask.id}/gates/rework`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ target: 'specify', comment: '' }),
    })
    expect(emptyRework.status).toBe(400)
    expect(await emptyRework.json()).toMatchObject({
      code: 'validation',
      fields: { comment: expect.any(Array) },
    })

    const reworked = await app.request(`/api/v1/tasks/${reworkedTask.id}/gates/rework`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ target: 'specify', comment: 'Recheck the external constraints' }),
    })
    expect(reworked.status).toBe(200)
    expect(await reworked.json()).toMatchObject({ task: { status: 'specify' } })

    const notes = await db
      .select()
      .from(feedback)
      .where(inArray(feedback.taskId, [redirectedTask.id, reworkedTask.id]))
      .orderBy(asc(feedback.createdAt))
    expect(notes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: redirectedTask.id,
          kind: 'redirect',
          textMd: 'Clarify the scope before research',
        }),
        expect.objectContaining({
          taskId: reworkedTask.id,
          kind: 'rework',
          textMd: 'Recheck the external constraints',
        }),
      ]),
    )

    const runningTask = await seedAt('specify', 'running')
    const rejected = await app.request(`/api/v1/tasks/${runningTask.id}/gates/approve`, {
      method: 'POST',
      headers: auth,
    })
    expect(rejected.status).toBe(409)
    expect(await rejected.json()).toMatchObject({ code: 'conflict', detail: expect.any(String) })

    const [unchanged] = await db
      .select({ status: tasks.status })
      .from(tasks)
      .where(eq(tasks.id, runningTask.id))
    expect(unchanged?.status).toBe('specify')
  })

  it('a redirect past the kickoff cap is refused as a conflict, leaving the task at its gate', async () => {
    const dag = instantiateDefinition(PIPELINE_CATALOG.feature)
    const [task] = await db
      .insert(tasks)
      .values({
        slug: `kickoff-cap-${crypto.randomUUID().slice(0, 8)}`,
        title: 'Kickoff cap fixture',
        type: 'feature',
        repoUrl: 'https://github.com/example/kickoff-cap-fixture',
        repositoryId: await repositoryIdFor(db, 'https://github.com/example/kickoff-cap-fixture'),
        status: 'human_kickoff_gate',
      })
      .returning()
    if (!task) throw new Error('kickoff cap task insert returned no row')
    createdTaskIds.push(task.id)
    await db.insert(runGraphs).values({ taskId: task.id, dag })
    // Two redirects already spent the default cap (`max_kickoff_regenerations: 2`).
    await db.insert(events).values([
      { taskId: task.id, type: 'gate.redirected', payload: { gate: 'human_kickoff_gate' } },
      { taskId: task.id, type: 'gate.redirected', payload: { gate: 'human_kickoff_gate' } },
    ])

    const thirdRedirect = await app.request(`/api/v1/tasks/${task.id}/gates/redirect`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ comment: 'One more pass, please' }),
    })

    expect(thirdRedirect.status).toBe(409)
    expect(await thirdRedirect.json()).toMatchObject({
      code: 'conflict',
      detail: expect.any(String),
    })
    const [unchanged] = await db
      .select({ status: tasks.status })
      .from(tasks)
      .where(eq(tasks.id, task.id))
    expect(unchanged?.status).toBe('human_kickoff_gate')
  })

  it('lists a task’s decisions and answers or dismisses them through their own endpoints', async () => {
    const dag = instantiateDefinition(PIPELINE_CATALOG.feature)
    const [task] = await db
      .insert(tasks)
      .values({
        slug: `decision-${crypto.randomUUID().slice(0, 8)}`,
        title: 'Decision fixture',
        type: 'feature',
        repoUrl: 'https://github.com/example/decision-fixture',
        repositoryId: await repositoryIdFor(db, 'https://github.com/example/decision-fixture'),
        status: 'waiting_human',
        resumeStatus: 'specify',
      })
      .returning()
    if (!task) throw new Error('decision task insert returned no row')
    createdTaskIds.push(task.id)
    await db.insert(runGraphs).values({ taskId: task.id, dag })

    const [decision] = await db
      .insert(decisions)
      .values({
        taskId: task.id,
        nodeKey: 'specify',
        key: 'scope',
        kind: 'question',
        promptMd: 'What does this cover?',
      })
      .returning()
    if (!decision) throw new Error('decision insert returned no row')

    const listed = await app.request(`/api/v1/tasks/${task.id}/decisions`, { headers: auth })
    expect(listed.status).toBe(200)
    const { decisions: listedDecisions } = (await listed.json()) as {
      decisions: { id: string; status: string; conversationId: string | null }[]
    }
    expect(listedDecisions).toHaveLength(1)
    expect(listedDecisions[0]).toMatchObject({
      id: decision.id,
      status: 'open',
      conversationId: null,
    })

    const emptyAnswer = await app.request(`/api/v1/decisions/${decision.id}/answer`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({}),
    })
    expect(emptyAnswer.status).toBe(400)
    expect(await emptyAnswer.json()).toMatchObject({ code: 'validation' })

    const answered = await app.request(`/api/v1/decisions/${decision.id}/answer`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ text: 'The whole repository.' }),
    })
    expect(answered.status).toBe(200)
    expect(await answered.json()).toMatchObject({ task: { status: 'specify' } })

    const alreadyAnswered = await app.request(`/api/v1/decisions/${decision.id}/answer`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ text: 'Again?' }),
    })
    expect(alreadyAnswered.status).toBe(409)
    expect(await alreadyAnswered.json()).toMatchObject({ code: 'conflict' })

    const missing = await app.request(`/api/v1/decisions/${crypto.randomUUID()}/dismiss`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({}),
    })
    expect(missing.status).toBe(404)

    const [second] = await db
      .insert(decisions)
      .values({
        taskId: task.id,
        nodeKey: 'specify',
        key: 'owner',
        kind: 'question',
        promptMd: 'Who owns this?',
      })
      .returning()
    if (!second) throw new Error('second decision insert returned no row')
    const [conversation] = await db
      .insert(conversations)
      .values({ taskId: task.id, subjectKind: 'decision', subjectId: second.id })
      .returning()
    if (!conversation) throw new Error('conversation insert returned no row')

    const relisted = await app.request(`/api/v1/tasks/${task.id}/decisions`, { headers: auth })
    const { decisions: relistedDecisions } = (await relisted.json()) as {
      decisions: {
        id: string
        status: string
        conversationId: string | null
        answerMd: string | null
      }[]
    }
    expect(relistedDecisions).toHaveLength(2)
    const resolved = relistedDecisions.find((d) => d.id === decision.id)
    const open = relistedDecisions.find((d) => d.id === second.id)
    expect(resolved).toMatchObject({ status: 'answered', answerMd: 'The whole repository.' })
    expect(open).toMatchObject({ status: 'open', conversationId: conversation.id })
  })

  it('lists decisions in a deterministic order even when several share the same createdAt', async () => {
    const dag = instantiateDefinition(PIPELINE_CATALOG.feature)
    const [task] = await db
      .insert(tasks)
      .values({
        slug: `decision-order-${crypto.randomUUID().slice(0, 8)}`,
        title: 'Decision ordering fixture',
        type: 'feature',
        repoUrl: 'https://github.com/example/decision-order-fixture',
        repositoryId: await repositoryIdFor(
          db,
          'https://github.com/example/decision-order-fixture',
        ),
        status: 'waiting_human',
        resumeStatus: 'specify',
      })
      .returning()
    if (!task) throw new Error('decision task insert returned no row')
    createdTaskIds.push(task.id)
    await db.insert(runGraphs).values({ taskId: task.id, dag })

    // A single stage result raising several decisions inserts them inside
    // one transaction, giving them byte-identical createdAt timestamps.
    const tied = new Date('2026-08-16T12:00:00.000Z')
    const seededDecisions = await db
      .insert(decisions)
      .values([
        {
          taskId: task.id,
          nodeKey: 'specify',
          key: 'a',
          kind: 'question',
          promptMd: 'A',
          createdAt: tied,
        },
        {
          taskId: task.id,
          nodeKey: 'specify',
          key: 'b',
          kind: 'question',
          promptMd: 'B',
          createdAt: tied,
        },
        {
          taskId: task.id,
          nodeKey: 'specify',
          key: 'c',
          kind: 'question',
          promptMd: 'C',
          createdAt: tied,
        },
      ])
      .returning()
    const expectedOrder = [...seededDecisions]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((d) => d.id)

    const first = await app.request(`/api/v1/tasks/${task.id}/decisions`, { headers: auth })
    const second = await app.request(`/api/v1/tasks/${task.id}/decisions`, { headers: auth })
    const { decisions: firstDecisions } = (await first.json()) as { decisions: { id: string }[] }
    const { decisions: secondDecisions } = (await second.json()) as { decisions: { id: string }[] }

    expect(firstDecisions.map((d) => d.id)).toEqual(expectedOrder)
    expect(secondDecisions.map((d) => d.id)).toEqual(expectedOrder)
  })

  it('answering the last blocker of a task with no recorded resume state surfaces a stable conflict code, not a bare 500', async () => {
    const dag = instantiateDefinition(PIPELINE_CATALOG.feature)
    const [task] = await db
      .insert(tasks)
      .values({
        slug: `decision-no-resume-${crypto.randomUUID().slice(0, 8)}`,
        title: 'No resume state fixture',
        type: 'feature',
        repoUrl: 'https://github.com/example/no-resume-fixture',
        repositoryId: await repositoryIdFor(db, 'https://github.com/example/no-resume-fixture'),
        status: 'waiting_human',
        resumeStatus: null,
      })
      .returning()
    if (!task) throw new Error('no-resume task insert returned no row')
    createdTaskIds.push(task.id)
    await db.insert(runGraphs).values({ taskId: task.id, dag })

    const [decision] = await db
      .insert(decisions)
      .values({
        taskId: task.id,
        nodeKey: 'specify',
        key: 'scope',
        kind: 'question',
        promptMd: 'What does this cover?',
      })
      .returning()
    if (!decision) throw new Error('decision insert returned no row')

    const response = await app.request(`/api/v1/decisions/${decision.id}/answer`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ text: 'The whole repository.' }),
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'conflict', detail: expect.any(String) })
  })

  it('a confirmed answer_decision conversation action resumes the task exactly like the direct control', async () => {
    const dag = instantiateDefinition(PIPELINE_CATALOG.feature)
    const [task] = await db
      .insert(tasks)
      .values({
        slug: `decision-action-${crypto.randomUUID().slice(0, 8)}`,
        title: 'Decision action fixture',
        type: 'feature',
        repoUrl: 'https://github.com/example/decision-action-fixture',
        repositoryId: await repositoryIdFor(
          db,
          'https://github.com/example/decision-action-fixture',
        ),
        status: 'waiting_human',
        resumeStatus: 'specify',
      })
      .returning()
    if (!task) throw new Error('decision action task insert returned no row')
    createdTaskIds.push(task.id)
    await db.insert(runGraphs).values({ taskId: task.id, dag })

    const [decision] = await db
      .insert(decisions)
      .values({
        taskId: task.id,
        nodeKey: 'specify',
        key: 'scope',
        kind: 'question',
        promptMd: 'What does this cover?',
      })
      .returning()
    if (!decision) throw new Error('decision insert returned no row')
    const [conversation] = await db
      .insert(conversations)
      .values({ taskId: task.id, subjectKind: 'decision', subjectId: decision.id })
      .returning()
    if (!conversation) throw new Error('conversation insert returned no row')
    const [message] = await db
      .insert(conversationMessages)
      .values({
        conversationId: conversation.id,
        sequence: 1,
        role: 'assistant',
        contentMd: 'I recommend "the whole repository".',
        status: 'completed',
        taskState: 'waiting_human',
      })
      .returning()
    if (!message) throw new Error('message insert returned no row')
    const [action] = await db
      .insert(conversationActions)
      .values({
        taskId: task.id,
        conversationId: conversation.id,
        messageId: message.id,
        kind: 'answer_decision',
        target: { taskId: task.id, decisionId: decision.id },
        instruction: 'The whole repository.',
        expectedVersion: { taskStatus: 'waiting_human', decisionStatus: 'open' },
      })
      .returning()
    if (!action) throw new Error('action insert returned no row')

    const confirmed = await app.request(
      `/api/v1/tasks/${task.id}/conversations/${conversation.id}/actions/${action.id}/confirm`,
      {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ idempotencyKey: `action:${action.id}` }),
      },
    )
    expect(confirmed.status).toBe(200)
    expect(await confirmed.json()).toMatchObject({ task: { status: 'specify' } })
    const [resolved] = await db.select().from(decisions).where(eq(decisions.id, decision.id))
    expect(resolved).toMatchObject({ status: 'answered', answerMd: 'The whole repository.' })
  })

  it('replays and follows conversation events from the last delivered sequence', async () => {
    const [task] = await db
      .insert(tasks)
      .values({
        slug: `stream-${crypto.randomUUID().slice(0, 8)}`,
        title: 'Stream fixture',
        type: 'bugfix',
        repoUrl: 'https://github.com/example/stream-fixture',
        repositoryId: await repositoryIdFor(db, 'https://github.com/example/stream-fixture'),
      })
      .returning()
    if (!task) throw new Error('task insert returned no row')
    createdTaskIds.push(task.id)

    const [baseline] = await db
      .insert(events)
      .values({ taskId: task.id, type: 'task.created', payload: {} })
      .returning()
    if (!baseline) throw new Error('stream cursor event was not inserted')

    // Two events via the real API before the stream opens (replayed from cursor),
    // then a third posted live once the stream is already reading.
    const created = await app.request(`/api/v1/tasks/${task.id}/conversations`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
    })
    const { conversation } = (await created.json()) as { conversation: { id: string } }
    const firstMessage = await app.request(
      `/api/v1/tasks/${task.id}/conversations/${conversation.id}/messages`,
      {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ message: 'What changed?', idempotencyKey: crypto.randomUUID() }),
      },
    )
    expect(firstMessage.status).toBe(201)

    const response = await app.request(`/api/v1/tasks/${task.id}/events/stream`, {
      headers: {
        authorization: 'Bearer test-password',
        'last-event-id': String(baseline.seq),
      },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    if (!response.body) throw new Error('stream response has no body')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    const frames: string[] = []
    let buffer = ''
    let sawHeartbeat = false

    async function nextEvent() {
      while (frames.length === 0) {
        const chunk = await reader.read()
        if (chunk.done) throw new Error('event stream ended early')

        buffer += decoder.decode(chunk.value, { stream: true })
        const split = buffer.split('\n\n')
        buffer = split.pop() ?? ''
        for (const frame of split) {
          if (frame.startsWith(':')) {
            sawHeartbeat = true
          } else if (frame.length > 0) {
            frames.push(frame)
          }
        }
      }

      const frame = frames.shift()
      if (!frame) throw new Error('event frame queue was empty')

      const lines = new Map(
        frame.split('\n').map((line) => {
          const separator = line.indexOf(': ')

          return [line.slice(0, separator), line.slice(separator + 2)]
        }),
      )

      return {
        id: Number(lines.get('id')),
        event: lines.get('event'),
        data: JSON.parse(lines.get('data') ?? 'null') as { seq: number; payload: unknown },
      }
    }

    const replayed = [await nextEvent(), await nextEvent()]
    expect(replayed.map((event) => event.event)).toEqual([
      'conversation.created',
      'conversation.message.created',
    ])
    expect(replayed[0]?.data).toMatchObject({ payload: { conversationId: conversation.id } })
    expect(replayed[1]?.data).toMatchObject({ payload: { conversationId: conversation.id } })

    const secondMessage = await app.request(
      `/api/v1/tasks/${task.id}/conversations/${conversation.id}/messages`,
      {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ message: 'And after that?', idempotencyKey: crypto.randomUUID() }),
      },
    )
    expect(secondMessage.status).toBe(201)
    const live = await nextEvent()
    expect(live).toMatchObject({
      event: 'conversation.message.created',
      data: { payload: { conversationId: conversation.id } },
    })
    expect([...replayed.map((event) => event.id), live.id]).toEqual(
      [...replayed.map((event) => event.id), live.id].sort((left, right) => left - right),
    )
    expect(sawHeartbeat).toBe(true)

    await reader.cancel()
  })
})

const LONG_FILE_LINES = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).concat('')

describeDb('api task diff', () => {
  let app: ReturnType<typeof createApp>
  let db: Database
  let manager: WorkspaceManager
  let git: Git
  let originDir: string
  let originUrl: string
  let root: string
  const createdTaskIds: string[] = []
  const auth = { authorization: 'Bearer test-password' }

  beforeAll(async () => {
    db = createDb(url)
    originDir = await mkdtemp(join(tmpdir(), 'api-diff-origin-'))
    git = new Git(resolveWorkspaceConfig({ root: originDir }))
    await git.run(['init', '--quiet', '-b', 'main', originDir])
    await writeFile(join(originDir, 'README.md'), '# origin\n')
    // Long enough that a one-line edit in its middle leaves context outside the
    // default three lines for a widened read to reach (AC-1063).
    await writeFile(join(originDir, 'long.txt'), LONG_FILE_LINES.join('\n'))
    await git.run(['add', '-A'], { cwd: originDir })
    await git.run(['commit', '--quiet', '-m', 'init'], { cwd: originDir })
    originUrl = `file://${originDir}`

    root = await mkdtemp(join(tmpdir(), 'api-diff-root-'))
    manager = new WorkspaceManager({ config: { root } })
    const workspaceService = new WorkspaceService(manager, db, () =>
      Promise.reject(new Error('diff tests never resolve an environment')),
    )

    app = createApp({
      db,
      gates: createEngine(db),
      workspace: workspaceService,
      config: loadConfig({
        DATABASE_URL: url,
        NODE_ENV: 'test',
        SPECMATE_PASSWORD: 'test-password',
        WORKSPACE_ROOT: root,
      }),
    })
  })

  afterAll(async () => {
    try {
      if (createdTaskIds.length > 0) {
        await db.delete(tasks).where(inArray(tasks.id, createdTaskIds))
      }
    } finally {
      await db.$client.close()
      await rm(originDir, { recursive: true, force: true })
      await rm(root, { recursive: true, force: true })
    }
  })

  /** Provisioning is two steps now; a diff fixture takes the layout its task will pin. */
  async function provisionApiWorkspace(
    workspaceManager: WorkspaceManager,
    request: Parameters<WorkspaceManager['provision']>[0],
  ) {
    const tree = await workspaceManager.provision(request)

    return workspaceManager.openChangeFolder(tree, 'repository')
  }

  async function createDiffTask(slug: string): Promise<string> {
    const [task] = await db
      .insert(tasks)
      .values({
        slug,
        title: 'Diff fixture',
        type: 'feature',
        repoUrl: originUrl,
        repositoryId: await repositoryIdFor(db, originUrl),
        baseBranch: 'main',
      })
      .returning()
    assert(task)
    createdTaskIds.push(task.id)

    return task.id
  }

  it('lists product code alone where the repository carries no change folder — AC-1722', async () => {
    const slug = `diff-internal-${crypto.randomUUID().slice(0, 8)}`
    const taskId = await createDiffTask(slug)
    await db.update(tasks).set({ changeLayout: 'internal' }).where(eq(tasks.id, taskId))
    const tree = await manager.provision({
      slug,
      repoUrl: originUrl,
      mirrorKey: mirrorKey(originUrl),
      baseBranch: 'main',
    })
    const workspace = await manager.openChangeFolder(tree, 'internal')
    await mkdir(join(workspace.path, 'src'), { recursive: true })
    await writeFile(join(workspace.path, 'src', 'added.ts'), 'export const a = 1\n')
    await writeFile(join(workspace.path, workspace.changeDir, 'proposal.md'), '# brief\n')
    await manager.commitStage(workspace, {
      stageId: crypto.randomUUID(),
      role: 'implementer',
      provider: 'claude-code',
      attempt: 1,
    })

    const response = await app.request(`/api/v1/tasks/${taskId}/diff/files`, { headers: auth })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      tip: expect.any(String),
      total: 1,
      files: [{ path: 'src/added.ts', status: 'added', group: 'code', additions: 1, deletions: 0 }],
    })
  })

  it('lists changed files with status and line counts (AC-1034)', async () => {
    const slug = `diff-files-${crypto.randomUUID().slice(0, 8)}`
    const taskId = await createDiffTask(slug)
    const workspace = await provisionApiWorkspace(manager, {
      slug,
      repoUrl: originUrl,
      mirrorKey: mirrorKey(originUrl),
      baseBranch: 'main',
    })
    await mkdir(join(workspace.path, 'src'), { recursive: true })
    await writeFile(join(workspace.path, 'src', 'added.ts'), 'export const a = 1\n')
    await manager.commitStage(workspace, {
      stageId: crypto.randomUUID(),
      role: 'implementer',
      provider: 'claude-code',
      attempt: 1,
    })

    const response = await app.request(`/api/v1/tasks/${taskId}/diff/files`, { headers: auth })

    expect(response.status).toBe(200)
    // The change folder is grouped, not withheld (AC-1060): its schema marker is
    // committed by provisioning, so it is one of the files this branch adds.
    expect(await response.json()).toEqual({
      tip: expect.any(String),
      total: expect.any(Number),
      files: expect.arrayContaining([
        { path: 'src/added.ts', status: 'added', group: 'code', additions: 1, deletions: 0 },
        {
          path: `openspec/changes/${slug}/.openspec.yaml`,
          status: 'added',
          group: 'spec',
          additions: 1,
          deletions: 0,
        },
      ]),
    })
  })

  it('returns an empty list before any product-code commit exists (AC-1035)', async () => {
    const slug = `diff-empty-${crypto.randomUUID().slice(0, 8)}`
    const taskId = await createDiffTask(slug)
    await manager.provision({
      slug,
      repoUrl: originUrl,
      mirrorKey: mirrorKey(originUrl),
      baseBranch: 'main',
    })

    const response = await app.request(`/api/v1/tasks/${taskId}/diff/files`, { headers: auth })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ tip: expect.any(String), total: 0, files: [] })
  })

  it('returns one file unified diff by path (AC-1036)', async () => {
    const slug = `diff-file-${crypto.randomUUID().slice(0, 8)}`
    const taskId = await createDiffTask(slug)
    const workspace = await provisionApiWorkspace(manager, {
      slug,
      repoUrl: originUrl,
      mirrorKey: mirrorKey(originUrl),
      baseBranch: 'main',
    })
    await writeFile(join(workspace.path, 'README.md'), '# origin\nextra line\n')
    await manager.commitStage(workspace, {
      stageId: crypto.randomUUID(),
      role: 'implementer',
      provider: 'claude-code',
      attempt: 1,
    })

    const response = await app.request(`/api/v1/tasks/${taskId}/diff/file?path=README.md`, {
      headers: auth,
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as { path: string; diff: string }
    expect(body.path).toBe('README.md')
    expect(body.diff).toContain('+extra line')
  })

  it('names the commit the comparison was computed against, and renames it on a new commit (AC-1062)', async () => {
    const slug = `diff-tip-${crypto.randomUUID().slice(0, 8)}`
    const taskId = await createDiffTask(slug)
    const workspace = await provisionApiWorkspace(manager, {
      slug,
      repoUrl: originUrl,
      mirrorKey: mirrorKey(originUrl),
      baseBranch: 'main',
    })
    const commit = () =>
      manager.commitStage(workspace, {
        stageId: crypto.randomUUID(),
        role: 'implementer',
        provider: 'claude-code',
        attempt: 1,
      })

    await writeFile(join(workspace.path, 'README.md'), '# origin\nfirst\n')
    await commit()
    const first = await app.request(`/api/v1/tasks/${taskId}/diff/files`, { headers: auth })
    const firstTip = ((await first.json()) as { tip: string }).tip

    await writeFile(join(workspace.path, 'README.md'), '# origin\nfirst\nsecond\n')
    await commit()
    const second = await app.request(`/api/v1/tasks/${taskId}/diff/files`, { headers: auth })
    const secondTip = ((await second.json()) as { tip: string }).tip

    expect(firstTip).toMatch(/^[0-9a-f]{40}$/)
    expect(secondTip).not.toBe(firstTip)
  })

  it('returns more surrounding context when a wider read is asked for (AC-1063)', async () => {
    const slug = `diff-context-${crypto.randomUUID().slice(0, 8)}`
    const taskId = await createDiffTask(slug)
    const workspace = await provisionApiWorkspace(manager, {
      slug,
      repoUrl: originUrl,
      mirrorKey: mirrorKey(originUrl),
      baseBranch: 'main',
    })
    const edited = [...LONG_FILE_LINES]
    edited[19] = 'line 20 edited'
    await writeFile(join(workspace.path, 'long.txt'), edited.join('\n'))
    await manager.commitStage(workspace, {
      stageId: crypto.randomUUID(),
      role: 'implementer',
      provider: 'claude-code',
      attempt: 1,
    })

    const read = async (query: string) => {
      const response = await app.request(`/api/v1/tasks/${taskId}/diff/file?${query}`, {
        headers: auth,
      })
      expect(response.status).toBe(200)

      return ((await response.json()) as { diff: string }).diff
    }

    const narrow = await read('path=long.txt')
    const wide = await read('path=long.txt&context=30')

    expect(narrow).toContain('+line 20 edited')
    expect(narrow).not.toContain('line 1\n')
    expect(wide).toContain('+line 20 edited')
    expect(wide).toContain('line 1\n')
  })

  it('reads the same diff after the workspace has been released (AC-1037)', async () => {
    const slug = `diff-released-${crypto.randomUUID().slice(0, 8)}`
    const taskId = await createDiffTask(slug)
    const workspace = await provisionApiWorkspace(manager, {
      slug,
      repoUrl: originUrl,
      mirrorKey: mirrorKey(originUrl),
      baseBranch: 'main',
    })
    await writeFile(join(workspace.path, 'README.md'), '# origin\nafter release\n')
    await manager.commitStage(workspace, {
      stageId: crypto.randomUUID(),
      role: 'implementer',
      provider: 'claude-code',
      attempt: 1,
    })
    await manager.release(slug, mirrorKey(originUrl))

    const response = await app.request(`/api/v1/tasks/${taskId}/diff/files`, { headers: auth })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      tip: expect.any(String),
      total: expect.any(Number),
      files: expect.arrayContaining([
        { path: 'README.md', status: 'modified', group: 'code', additions: 1, deletions: 0 },
      ]),
    })
  })

  it('reports a resolvable-but-missing branch as not-found, not a crash (2.4)', async () => {
    const taskId = await createDiffTask(`diff-missing-${crypto.randomUUID().slice(0, 8)}`)

    const response = await app.request(`/api/v1/tasks/${taskId}/diff/files`, { headers: auth })

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: 'not_found' })
  })

  it('requires a path query parameter for the one-file diff', async () => {
    const taskId = await createDiffTask(`diff-noquery-${crypto.randomUUID().slice(0, 8)}`)

    const response = await app.request(`/api/v1/tasks/${taskId}/diff/file`, { headers: auth })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'validation' })
  })

  it('treats the path query parameter as one literal file, not a git pathspec (regression)', async () => {
    const slug = `diff-pathspec-${crypto.randomUUID().slice(0, 8)}`
    const taskId = await createDiffTask(slug)
    const workspace = await provisionApiWorkspace(manager, {
      slug,
      repoUrl: originUrl,
      mirrorKey: mirrorKey(originUrl),
      baseBranch: 'main',
    })
    await writeFile(join(workspace.path, 'README.md'), '# origin\nextra line\n')
    await manager.commitStage(workspace, {
      stageId: crypto.randomUUID(),
      role: 'implementer',
      provider: 'claude-code',
      attempt: 1,
    })

    const response = await app.request(`/api/v1/tasks/${taskId}/diff/file?path=.`, {
      headers: auth,
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ path: '.', diff: '' })
  })

  it('reports a task branch with no common history as not-found, not a crash', async () => {
    const slug = `diff-unrelated-${crypto.randomUUID().slice(0, 8)}`
    const taskId = await createDiffTask(slug)
    const workspace = await provisionApiWorkspace(manager, {
      slug,
      repoUrl: originUrl,
      mirrorKey: mirrorKey(originUrl),
      baseBranch: 'main',
    })

    const strangerDir = await mkdtemp(join(tmpdir(), 'api-diff-stranger-'))
    const strangerGit = new Git(resolveWorkspaceConfig({ root: strangerDir }))
    await strangerGit.run(['init', '--quiet', '-b', 'stranger', strangerDir])
    await writeFile(join(strangerDir, 'STRANGER.md'), '# unrelated history\n')
    await strangerGit.run(['add', '-A'], { cwd: strangerDir })
    await strangerGit.run(['commit', '--quiet', '-m', 'unrelated root commit'], {
      cwd: strangerDir,
    })
    const strangerHead = (
      await strangerGit.run(['rev-parse', 'HEAD'], { cwd: strangerDir })
    ).stdout.trim()
    await git.inMirror(workspace.mirrorPath, ['fetch', '--quiet', strangerDir, 'stranger'])
    await git.inMirror(workspace.mirrorPath, [
      'update-ref',
      `refs/heads/${taskBranch(slug)}`,
      strangerHead,
    ])
    await rm(strangerDir, { recursive: true, force: true })

    const response = await app.request(`/api/v1/tasks/${taskId}/diff/files`, { headers: auth })
    const body = (await response.json()) as { code: string; detail: string }

    expect(response.status).toBe(404)
    expect(body.code).toBe('not_found')
    // The underlying GitError's own message embeds the mirror's absolute
    // filesystem path — never forwarded to the client (regression).
    expect(body.detail).not.toContain(workspace.mirrorPath)
  })
})
