import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'
import { instantiateDefinition, PIPELINE_CATALOG, type TaskState } from '@specmate/core'
import {
  conversationActions,
  conversationMessages,
  conversations,
  createDb,
  type Database,
  decisions,
  events,
  feedback,
  runGraphs,
  stages,
  tasks,
} from '@specmate/db'
import { Engine } from '@specmate/orchestrator/engine'
import { createTask as createOrchestratedTask } from '@specmate/orchestrator/store'
import { asc, eq, inArray } from 'drizzle-orm'
import { createApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'

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

  async function createTask(status: 'research' | 'archived' = 'research'): Promise<string> {
    const [task] = await db
      .insert(tasks)
      .values({
        slug: `api-conversation-${crypto.randomUUID().slice(0, 8)}`,
        title: 'API conversation fixture',
        type: 'feature',
        repoUrl: 'https://github.com/example/api-conversation',
        status,
      })
      .returning()
    assert(task)
    createdTaskIds.push(task.id)

    return task.id
  }

  test('health and authenticated task routes keep their structured boundary', async () => {
    expect((await app.request('/healthz')).status).toBe(200)
    const missing = await app.request('/api/v1/tasks')
    expect(missing.status).toBe(401)
    expect(await missing.json()).toMatchObject({ code: 'unauthenticated' })
  })

  test('creates, posts to, and hydrates one ordered conversation', async () => {
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

  test('rejects empty messages and terminal posts without changing the transcript', async () => {
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

  test('replays the same conversation and message pair for a repeated idempotency key', async () => {
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

  test('stops directly, blocks early restart, and idempotently stores restart guidance', async () => {
    const slug = `api-stop-${crypto.randomUUID().slice(0, 8)}`
    const { task, graph } = await createOrchestratedTask(db, {
      slug,
      title: 'API stop fixture',
      type: 'feature',
      repoUrl: 'https://github.com/example/api-stop',
      at: 'research',
    })
    createdTaskIds.push(task.id)
    const [stage] = await db
      .insert(stages)
      .values({
        taskId: task.id,
        graphId: graph.id,
        nodeKey: 'research',
        role: 'researcher',
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
        nodeKey: 'research',
        attempt: 0,
      }),
    })
    expect(stopped.status).toBe(200)
    expect(await stopped.json()).toMatchObject({
      task: { status: 'paused', resumeStatus: 'research' },
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

  test('confirms only an action belonging to the addressed conversation', async () => {
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
        taskState: 'research',
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
        expectedVersion: { taskStatus: 'research' },
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

  test('accepts a task with request text and returns it; accepts one without', async () => {
    const described = await app.request('/api/v1/tasks', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        title: 'Described task fixture',
        description: 'Fix the login redirect so it lands on the dashboard, not the homepage.',
        type: 'bugfix',
        repoUrl: 'https://github.com/example/described-task',
      }),
    })
    expect(described.status).toBe(201)
    const describedBody = (await described.json()) as { task: { id: string; description: string } }
    createdTaskIds.push(describedBody.task.id)
    expect(describedBody.task.description).toBe(
      'Fix the login redirect so it lands on the dashboard, not the homepage.',
    )

    const titleOnly = await app.request('/api/v1/tasks', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        title: 'Title-only task fixture',
        type: 'bugfix',
        repoUrl: 'https://github.com/example/title-only-task',
      }),
    })
    expect(titleOnly.status).toBe(201)
    const titleOnlyBody = (await titleOnly.json()) as {
      task: { id: string; description: string | null }
    }
    createdTaskIds.push(titleOnlyBody.task.id)
    expect(titleOnlyBody.task.description).toBeNull()

    const blankDescription = await app.request('/api/v1/tasks', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        title: 'Blank-description task fixture',
        description: '   ',
        type: 'bugfix',
        repoUrl: 'https://github.com/example/blank-description-task',
      }),
    })
    expect(blankDescription.status).toBe(201)
    const blankDescriptionBody = (await blankDescription.json()) as {
      task: { id: string; description: string | null }
    }
    createdTaskIds.push(blankDescriptionBody.task.id)
    expect(blankDescriptionBody.task.description).toBeNull()
  })

  test('rejects a description under 20,000 characters that exceeds 20,000 bytes in UTF-8', async () => {
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

  test('task detail reports spend against budget, with cost marked incomplete rather than zero when telemetry is missing — REQ-1505, AC-1512, AC-1513', async () => {
    const { task, graph } = await createOrchestratedTask(db, {
      slug: `spend-${crypto.randomUUID().slice(0, 8)}`,
      title: 'Spend fixture',
      type: 'feature',
      repoUrl: 'https://github.com/example/spend-fixture',
      budgets: { max_cost_usd: 20 },
      at: 'research',
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
        nodeKey: 'kickoff_brief',
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

  test('aggregates gate, failure, and stall attention without healthy tasks', async () => {
    const rollback = new Error('rollback attention fixture')

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
              status: 'human_spec_gate',
              updatedAt: new Date('2026-08-16T11:00:00.000Z'),
            },
            {
              slug: 'attention-failed',
              title: 'Failure fixture',
              type: 'bugfix',
              repoUrl: 'https://github.com/example/failure-fixture',
              status: 'failed',
              updatedAt: new Date('2026-08-16T10:00:00.000Z'),
            },
            {
              slug: 'attention-stalled',
              title: 'Stall fixture',
              type: 'feature',
              repoUrl: 'https://github.com/example/stall-fixture',
              status: 'implement',
            },
            {
              slug: 'attention-healthy',
              title: 'Healthy fixture',
              type: 'bugfix',
              repoUrl: 'https://github.com/example/healthy-fixture',
              status: 'research',
            },
            {
              slug: 'attention-decision',
              title: 'Decision fixture',
              type: 'feature',
              repoUrl: 'https://github.com/example/decision-fixture',
              status: 'research',
              updatedAt: new Date('2026-08-16T11:15:00.000Z'),
            },
            {
              slug: 'attention-parked-on-decision',
              title: 'Parked-on-decision fixture',
              type: 'feature',
              repoUrl: 'https://github.com/example/parked-decision-fixture',
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
              status: 'waiting_human',
              updatedAt: new Date('2026-08-16T11:35:00.000Z'),
            },
          ])
          .returning()
        const bySlug = new Map(seeded.map((task) => [task.slug, task]))
        const gateTask = bySlug.get('attention-gate')
        const failedTask = bySlug.get('attention-failed')
        const stalledTask = bySlug.get('attention-stalled')
        const healthyTask = bySlug.get('attention-healthy')
        const decisionTask = bySlug.get('attention-decision')
        const parkedOnDecisionTask = bySlug.get('attention-parked-on-decision')
        const orphanWaitingHumanTask = bySlug.get('attention-orphan-waiting-human')
        if (
          !gateTask ||
          !failedTask ||
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
            nodeKey: 'research',
            key: 'style-nit',
            kind: 'question',
            promptMd: 'Worth a follow-up task?',
            blocking: false,
            createdAt: new Date('2026-08-16T11:20:00.000Z'),
          },
          {
            taskId: parkedOnDecisionTask.id,
            nodeKey: 'research',
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
        expect(body.items).toHaveLength(6)
        expect(body.items.map((item) => item.reason.kind).sort()).toEqual([
          'decision',
          'decision',
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
        expect(failedItem?.reason.detail).toBe('attempt cap exhausted')
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

  test('requires bearer auth for streams and ignores query-string credentials', async () => {
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

  test('records task and stage-pinned comments with timeline events', async () => {
    const [task] = await db
      .insert(tasks)
      .values({
        slug: `comment-${crypto.randomUUID().slice(0, 8)}`,
        title: 'Comment fixture',
        type: 'feature',
        repoUrl: 'https://github.com/example/comment-fixture',
      })
      .returning()
    if (!task) throw new Error('task insert returned no row')
    createdTaskIds.push(task.id)

    const [graph] = await db
      .insert(runGraphs)
      .values({ taskId: task.id, dag: { nodes: [] } })
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

  test('delegates gate actions and rejects actions away from a gate', async () => {
    const dag = instantiateDefinition(PIPELINE_CATALOG.feature)

    async function seedAt(status: TaskState, label: string) {
      const [task] = await db
        .insert(tasks)
        .values({
          slug: `gate-${label}-${crypto.randomUUID().slice(0, 8)}`,
          title: `${label} gate fixture`,
          type: 'feature',
          repoUrl: `https://github.com/example/${label}-gate-fixture`,
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
    expect(await approved.json()).toMatchObject({ task: { status: 'research' } })

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
      body: JSON.stringify({ target: 'research', comment: '' }),
    })
    expect(emptyRework.status).toBe(400)
    expect(await emptyRework.json()).toMatchObject({
      code: 'validation',
      fields: { comment: expect.any(Array) },
    })

    const reworked = await app.request(`/api/v1/tasks/${reworkedTask.id}/gates/rework`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ target: 'research', comment: 'Recheck the external constraints' }),
    })
    expect(reworked.status).toBe(200)
    expect(await reworked.json()).toMatchObject({ task: { status: 'research' } })

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

    const runningTask = await seedAt('research', 'running')
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
    expect(unchanged?.status).toBe('research')
  })

  test('a redirect past the kickoff cap is refused as a conflict, leaving the task at its gate', async () => {
    const dag = instantiateDefinition(PIPELINE_CATALOG.feature)
    const [task] = await db
      .insert(tasks)
      .values({
        slug: `kickoff-cap-${crypto.randomUUID().slice(0, 8)}`,
        title: 'Kickoff cap fixture',
        type: 'feature',
        repoUrl: 'https://github.com/example/kickoff-cap-fixture',
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

  test('lists a task’s decisions and answers or dismisses them through their own endpoints', async () => {
    const dag = instantiateDefinition(PIPELINE_CATALOG.feature)
    const [task] = await db
      .insert(tasks)
      .values({
        slug: `decision-${crypto.randomUUID().slice(0, 8)}`,
        title: 'Decision fixture',
        type: 'feature',
        repoUrl: 'https://github.com/example/decision-fixture',
        status: 'waiting_human',
        resumeStatus: 'research',
      })
      .returning()
    if (!task) throw new Error('decision task insert returned no row')
    createdTaskIds.push(task.id)
    await db.insert(runGraphs).values({ taskId: task.id, dag })

    const [decision] = await db
      .insert(decisions)
      .values({
        taskId: task.id,
        nodeKey: 'research',
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
    expect(await answered.json()).toMatchObject({ task: { status: 'research' } })

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
        nodeKey: 'research',
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

  test('lists decisions in a deterministic order even when several share the same createdAt', async () => {
    const dag = instantiateDefinition(PIPELINE_CATALOG.feature)
    const [task] = await db
      .insert(tasks)
      .values({
        slug: `decision-order-${crypto.randomUUID().slice(0, 8)}`,
        title: 'Decision ordering fixture',
        type: 'feature',
        repoUrl: 'https://github.com/example/decision-order-fixture',
        status: 'waiting_human',
        resumeStatus: 'research',
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
          nodeKey: 'research',
          key: 'a',
          kind: 'question',
          promptMd: 'A',
          createdAt: tied,
        },
        {
          taskId: task.id,
          nodeKey: 'research',
          key: 'b',
          kind: 'question',
          promptMd: 'B',
          createdAt: tied,
        },
        {
          taskId: task.id,
          nodeKey: 'research',
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

  test('answering the last blocker of a task with no recorded resume state surfaces a stable conflict code, not a bare 500', async () => {
    const dag = instantiateDefinition(PIPELINE_CATALOG.feature)
    const [task] = await db
      .insert(tasks)
      .values({
        slug: `decision-no-resume-${crypto.randomUUID().slice(0, 8)}`,
        title: 'No resume state fixture',
        type: 'feature',
        repoUrl: 'https://github.com/example/no-resume-fixture',
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
        nodeKey: 'research',
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

  test('a confirmed answer_decision conversation action resumes the task exactly like the direct control', async () => {
    const dag = instantiateDefinition(PIPELINE_CATALOG.feature)
    const [task] = await db
      .insert(tasks)
      .values({
        slug: `decision-action-${crypto.randomUUID().slice(0, 8)}`,
        title: 'Decision action fixture',
        type: 'feature',
        repoUrl: 'https://github.com/example/decision-action-fixture',
        status: 'waiting_human',
        resumeStatus: 'research',
      })
      .returning()
    if (!task) throw new Error('decision action task insert returned no row')
    createdTaskIds.push(task.id)
    await db.insert(runGraphs).values({ taskId: task.id, dag })

    const [decision] = await db
      .insert(decisions)
      .values({
        taskId: task.id,
        nodeKey: 'research',
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
    expect(await confirmed.json()).toMatchObject({ task: { status: 'research' } })
    const [resolved] = await db.select().from(decisions).where(eq(decisions.id, decision.id))
    expect(resolved).toMatchObject({ status: 'answered', answerMd: 'The whole repository.' })
  })

  test('replays and follows conversation events from the last delivered sequence', async () => {
    const [task] = await db
      .insert(tasks)
      .values({
        slug: `stream-${crypto.randomUUID().slice(0, 8)}`,
        title: 'Stream fixture',
        type: 'bugfix',
        repoUrl: 'https://github.com/example/stream-fixture',
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
