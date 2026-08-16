import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { instantiateDefinition, PIPELINE_CATALOG, type TaskState } from '@specmate/core'
import {
  artifacts,
  createDb,
  type Database,
  events,
  feedback,
  runGraphs,
  stages,
  tasks,
} from '@specmate/db'
import { Engine } from '@specmate/orchestrator/engine'
import { asc, eq, inArray, sql } from 'drizzle-orm'
import { createApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

function createGateEngine(db: Database): Engine {
  return new Engine({
    db,
    workspaces: {
      provision: () => Promise.reject(new Error('API tests do not provision workspaces')),
      discard: () => Promise.reject(new Error('API tests do not discard workspaces')),
      release: () => Promise.resolve(),
    },
    settings: {
      stageConcurrency: 1,
      stageAttemptCap: 1,
      availableProviders: ['claude-code'],
    },
  })
}

describeDb('api', () => {
  let app: ReturnType<typeof createApp>
  let db: Database
  const createdTaskIds: string[] = []

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

  test('healthz needs no credentials', async () => {
    const res = await app.request('/healthz')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  test('readyz reports the database', async () => {
    const res = await app.request('/readyz')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, db: 'up' })
  })

  test('api routes reject a missing or wrong password', async () => {
    const missing = await app.request('/api/v1/tasks')
    expect(missing.status).toBe(401)
    expect(await missing.json()).toMatchObject({
      code: 'unauthenticated',
      detail: expect.any(String),
    })

    const wrong = await app.request('/api/v1/tasks', {
      headers: { authorization: 'Bearer nope' },
    })
    expect(wrong.status).toBe(401)
    expect(await wrong.json()).toMatchObject({
      code: 'unauthenticated',
      detail: expect.any(String),
    })
  })

  test('creates and lists a task', async () => {
    const auth = { authorization: 'Bearer test-password', 'content-type': 'application/json' }
    const created = await app.request('/api/v1/tasks', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        title: 'Verify the walking skeleton',
        type: 'bugfix',
        repoUrl: 'https://github.com/example/repo',
      }),
    })
    expect(created.status).toBe(201)
    const { task } = (await created.json()) as { task: { id: string; status: string } }
    createdTaskIds.push(task.id)
    expect(task.status).toBe('draft')

    const listed = await app.request('/api/v1/tasks', { headers: auth })
    const { tasks } = (await listed.json()) as { tasks: { id: string }[] }
    expect(tasks.some((t) => t.id === task.id)).toBe(true)

    const events = await app.request(`/api/v1/tasks/${task.id}/events`, { headers: auth })
    const body = (await events.json()) as { events: { type: string }[] }
    expect(body.events.map((e) => e.type)).toContain('task.created')
  })

  test('returns task detail with its latest run graph and stages', async () => {
    const auth = { authorization: 'Bearer test-password', 'content-type': 'application/json' }
    const created = await app.request('/api/v1/tasks', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        title: 'Inspect a pinned graph',
        type: 'feature',
        repoUrl: 'https://github.com/example/detail-fixture',
        baseBranch: 'main',
      }),
    })
    const { task } = (await created.json()) as { task: { id: string } }
    createdTaskIds.push(task.id)

    const [graph] = await db.select().from(runGraphs).where(eq(runGraphs.taskId, task.id)).limit(1)
    if (!graph) throw new Error('created task has no pinned run graph')

    const [stage] = await db
      .insert(stages)
      .values({
        taskId: task.id,
        graphId: graph.id,
        nodeKey: 'planning',
        role: 'planner',
        provider: 'claude-code',
        attempt: 1,
      })
      .returning()
    if (!stage) throw new Error('stage insert returned no row')

    const detail = await app.request(`/api/v1/tasks/${task.id}`, { headers: auth })
    expect(detail.status).toBe(200)
    expect(await detail.json()).toMatchObject({
      task: { id: task.id },
      graph: { id: graph.id, version: 1 },
      stages: [{ id: stage.id, nodeKey: 'planning', attempt: 1 }],
    })

    const missing = await app.request('/api/v1/tasks/00000000-0000-4000-8000-000000000000', {
      headers: auth,
    })
    expect(missing.status).toBe(404)
    expect(await missing.json()).toMatchObject({ code: 'not_found', detail: expect.any(String) })
  })

  test('lists artifact metadata and reads stored snapshot content', async () => {
    const auth = { authorization: 'Bearer test-password', 'content-type': 'application/json' }
    const created = await app.request('/api/v1/tasks', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        title: 'Read an artifact snapshot',
        type: 'bugfix',
        repoUrl: 'https://github.com/example/artifact-fixture',
      }),
    })
    const { task } = (await created.json()) as { task: { id: string } }
    createdTaskIds.push(task.id)

    const [artifact] = await db
      .insert(artifacts)
      .values({
        taskId: task.id,
        path: 'openspec/changes/example/proposal.md',
        kind: 'proposal',
        gitSha: '0123456789abcdef',
        snapshotMd: '# Stored proposal\n',
      })
      .returning()
    if (!artifact) throw new Error('artifact insert returned no row')

    const listed = await app.request(`/api/v1/tasks/${task.id}/artifacts`, { headers: auth })
    expect(listed.status).toBe(200)
    expect(await listed.json()).toMatchObject({
      artifacts: [
        {
          id: artifact.id,
          path: artifact.path,
          kind: 'proposal',
          updatedAt: expect.any(String),
        },
      ],
    })

    const read = await app.request(`/api/v1/tasks/${task.id}/artifacts/${artifact.id}`, {
      headers: auth,
    })
    expect(read.status).toBe(200)
    expect(await read.json()).toMatchObject({
      artifact: {
        id: artifact.id,
        path: artifact.path,
        content: '# Stored proposal\n',
      },
    })
  })

  test('serializes recorded stage telemetry without inventing missing values', async () => {
    const auth = { authorization: 'Bearer test-password', 'content-type': 'application/json' }
    const created = await app.request('/api/v1/tasks', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        title: 'Inspect stage telemetry',
        type: 'feature',
        repoUrl: 'https://github.com/example/telemetry-fixture',
      }),
    })
    const { task } = (await created.json()) as { task: { id: string } }
    createdTaskIds.push(task.id)

    const [graph] = await db.select().from(runGraphs).where(eq(runGraphs.taskId, task.id)).limit(1)
    if (!graph) throw new Error('created task has no pinned run graph')

    const startedAt = new Date('2026-08-16T08:00:00.000Z')
    const finishedAt = new Date('2026-08-16T08:00:12.000Z')
    await db.insert(stages).values([
      {
        taskId: task.id,
        graphId: graph.id,
        nodeKey: 'implement',
        role: 'implementer',
        provider: 'codex',
        status: 'succeeded',
        attempt: 1,
        startedAt,
        finishedAt,
        cost: sql`'{"model":"gpt-5","tokens":{"input":1200,"output":340,"cache":0},"costUsd":0.42,"raw":{"ignored":true}}'::jsonb`,
      },
      {
        taskId: task.id,
        graphId: graph.id,
        nodeKey: 'verify',
        role: 'verifier',
        provider: 'claude-code',
        attempt: 1,
      },
    ])

    const detail = await app.request(`/api/v1/tasks/${task.id}`, { headers: auth })
    expect(detail.status).toBe(200)
    expect(await detail.json()).toMatchObject({
      stages: [
        {
          nodeKey: 'implement',
          provider: 'codex',
          telemetry: {
            model: 'gpt-5',
            startedAt: startedAt.toISOString(),
            finishedAt: finishedAt.toISOString(),
            tokens: { input: 1200, output: 340, cache: 0 },
            costUsd: 0.42,
          },
        },
        {
          nodeKey: 'verify',
          provider: 'claude-code',
          telemetry: null,
        },
      ],
    })
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
        const auth = { authorization: 'Bearer test-password' }

        const empty = await isolatedApp.request('/api/v1/attention', { headers: auth })
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
          ])
          .returning()
        const bySlug = new Map(seeded.map((task) => [task.slug, task]))
        const gateTask = bySlug.get('attention-gate')
        const failedTask = bySlug.get('attention-failed')
        const stalledTask = bySlug.get('attention-stalled')
        const healthyTask = bySlug.get('attention-healthy')
        if (!gateTask || !failedTask || !stalledTask || !healthyTask) {
          throw new Error('attention fixtures were not inserted')
        }

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

        const response = await isolatedApp.request('/api/v1/attention', { headers: auth })
        expect(response.status).toBe(200)
        const body = (await response.json()) as {
          items: {
            task: { id: string }
            reason: { kind: string; detail: string }
            since: string
          }[]
        }
        expect(body.items).toHaveLength(3)
        expect(body.items.map((item) => item.reason.kind).sort()).toEqual([
          'failed',
          'gate',
          'stalled',
        ])
        expect(body.items.map((item) => item.task.id)).not.toContain(healthyTask.id)
        const gateItem = body.items.find((item) => item.task.id === gateTask.id)
        const failedItem = body.items.find((item) => item.task.id === failedTask.id)
        expect(gateItem?.since).toBe('2026-08-16T11:00:00.000Z')
        expect(failedItem?.since).toBe('2026-08-16T10:00:00.000Z')
        expect(failedItem?.reason.detail).toBe('attempt cap exhausted')

        throw rollback
      })
    } catch (error) {
      if (error !== rollback) {
        throw error
      }
    }
  })

  test('replays and follows task events from the last delivered sequence', async () => {
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

    const seeded = await db
      .insert(events)
      .values([
        { taskId: task.id, type: 'stage.started', payload: { ordinal: 1 } },
        { taskId: task.id, type: 'stage.completed', payload: { ordinal: 2 } },
      ])
      .returning()
    const cursor = seeded[0]?.seq
    const replayed = seeded[1]
    if (cursor === undefined || !replayed) throw new Error('stream events were not inserted')

    const response = await app.request(`/api/v1/tasks/${task.id}/events/stream`, {
      headers: {
        authorization: 'Bearer test-password',
        'last-event-id': String(cursor),
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

    const first = await nextEvent()
    expect(first).toMatchObject({
      id: replayed.seq,
      event: 'stage.completed',
      data: { seq: replayed.seq, payload: { ordinal: 2 } },
    })

    const [live] = await db
      .insert(events)
      .values({ taskId: task.id, type: 'task.parked', payload: { ordinal: 3 } })
      .returning()
    if (!live) throw new Error('live stream event was not inserted')

    const second = await nextEvent()
    expect(second).toMatchObject({
      id: live.seq,
      event: 'task.parked',
      data: { seq: live.seq, payload: { ordinal: 3 } },
    })
    expect([first.id, second.id]).toEqual([replayed.seq, live.seq])
    expect(sawHeartbeat).toBe(true)

    await reader.cancel()
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

    const auth = { authorization: 'Bearer test-password', 'content-type': 'application/json' }
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
    const auth = { authorization: 'Bearer test-password', 'content-type': 'application/json' }
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
      .limit(1)
    expect(unchanged?.status).toBe('research')
  })

  test('names every invalid intake field', async () => {
    const res = await app.request('/api/v1/tasks', {
      method: 'POST',
      headers: { authorization: 'Bearer test-password', 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'chore', repoUrl: 'not-a-url' }),
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({
      code: 'validation',
      detail: expect.any(String),
      fields: {
        title: expect.any(Array),
        type: expect.any(Array),
        repoUrl: expect.any(Array),
      },
    })
  })

  test('accepts a request body sent without a Content-Type header', async () => {
    const res = await app.request('/api/v1/tasks', {
      method: 'POST',
      headers: { authorization: 'Bearer test-password' },
      body: JSON.stringify({
        title: 'Headerless create',
        type: 'feature',
        repoUrl: 'https://github.com/example/repo',
      }),
    })
    expect(res.status).toBe(201)
    const { task } = (await res.json()) as { task: { id: string; title: string } }
    createdTaskIds.push(task.id)
    expect(task.title).toBe('Headerless create')
  })
})
