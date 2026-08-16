import { isHumanGate, isTerminal, TaskState } from '@specmate/core'
import {
  artifacts,
  type Database,
  events,
  feedback,
  ping,
  runGraphs,
  type Stage,
  stages,
  type Task,
  tasks,
} from '@specmate/db'
import type { Engine } from '@specmate/orchestrator/engine'
import { createTask } from '@specmate/orchestrator/store'
import { and, asc, desc, eq, gt, inArray } from 'drizzle-orm'
import { type Context, Hono } from 'hono'
import { logger } from 'hono/logger'
import { streamSSE } from 'hono/streaming'
import { validator } from 'hono/validator'
import { z } from 'zod'
import { passwordAuth } from './auth.ts'
import type { Config } from './config.ts'
import { ApiError, handleApiError, type ValidationFields } from './errors.ts'

export interface AppDeps {
  db: Database
  config: Config
  gates: GateOperations
  now?: () => Date
  stream?: Partial<StreamSettings>
}

export type GateOperations = Pick<Engine, 'approve' | 'redirect' | 'rework'>

interface StreamSettings {
  pollIntervalMs: number
  heartbeatIntervalMs: number
}

interface EventQuery {
  cursor: number
  taskId?: string
}

interface AttentionItem {
  task: Pick<Task, 'id' | 'slug' | 'title' | 'type' | 'status'>
  reason: {
    kind: 'gate' | 'failed' | 'stalled'
    detail: string
  }
  since: Date
}

const CreateTask = z.object({
  title: z.string().trim().min(1).max(200),
  type: z.enum(['feature', 'bugfix']),
  repoUrl: z.url(),
  baseBranch: z.string().trim().min(1).default('main'),
})

const CreateComment = z.object({
  comment: z.string().trim().min(1).max(20_000),
  stageId: z.uuid().optional(),
})

const GateComment = z.object({
  comment: z.string().trim().min(1).max(20_000),
})

const ReworkGate = GateComment.extend({
  target: TaskState,
})

const GATE_CONFLICT_ERRORS = new Set([
  'GateEdgeError',
  'IllegalTransitionError',
  'NotAtGateError',
  'RedirectCapExhaustedError',
  'ReworkTargetError',
  'StaleTransitionError',
])

const OWNER_ACTOR = 'owner'

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)

  return slug || 'task'
}

function validationFields(error: z.ZodError): ValidationFields {
  const fields: ValidationFields = {}
  for (const issue of error.issues) {
    const field = issue.path[0]?.toString() ?? 'body'
    fields[field] = [...(fields[field] ?? []), issue.message]
  }

  return fields
}

function validateJson<T extends z.ZodType>(schema: T) {
  return (value: unknown): z.output<T> => {
    const parsed = schema.safeParse(value)
    if (!parsed.success) {
      throw new ApiError('validation', 'request body is invalid', {
        status: 400,
        fields: validationFields(parsed.error),
      })
    }

    return parsed.data
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function numberRecord(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) {
    return null
  }

  const entries = Object.entries(value).filter(
    (entry): entry is [string, number] => typeof entry[1] === 'number',
  )

  return Object.fromEntries(entries)
}

function serializeStage(stage: Stage) {
  const usage: Record<string, unknown> = isRecord(stage.cost) ? stage.cost : {}
  const model = typeof usage.model === 'string' ? usage.model : null
  const tokens = numberRecord(usage.tokens)
  const costUsd = typeof usage.costUsd === 'number' ? usage.costUsd : null
  const hasTelemetry = model !== null || tokens !== null || costUsd !== null

  return {
    id: stage.id,
    taskId: stage.taskId,
    graphId: stage.graphId,
    nodeKey: stage.nodeKey,
    role: stage.role,
    provider: stage.provider,
    status: stage.status,
    attempt: stage.attempt,
    skillSha: stage.skillSha,
    result: stage.result,
    createdAt: stage.createdAt,
    updatedAt: stage.updatedAt,
    telemetry: hasTelemetry
      ? {
          model,
          startedAt: stage.startedAt,
          finishedAt: stage.finishedAt,
          tokens,
          costUsd,
        }
      : null,
  }
}

function parseEventCursor(value: string | undefined): number {
  if (value === undefined || value === '') {
    return 0
  }

  if (!/^\d+$/.test(value)) {
    throw new ApiError('validation', 'Last-Event-ID must be a non-negative integer', {
      status: 400,
      fields: { 'Last-Event-ID': ['must be a non-negative integer'] },
    })
  }

  const cursor = Number(value)
  if (!Number.isSafeInteger(cursor)) {
    throw new ApiError('validation', 'Last-Event-ID is outside the supported range', {
      status: 400,
      fields: { 'Last-Event-ID': ['is outside the supported range'] },
    })
  }

  return cursor
}

export function createApp({
  db,
  config,
  gates,
  now = () => new Date(),
  stream: streamOverrides,
}: AppDeps) {
  const app = new Hono()
  const streamSettings: StreamSettings = {
    pollIntervalMs: 1_000,
    heartbeatIntervalMs: 15_000,
    ...streamOverrides,
  }

  async function requireTask(id: string) {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1)
    if (!task) {
      throw new ApiError('not_found', 'task was not found', { status: 404 })
    }

    return task
  }

  async function performGateAction(action: () => Promise<void>): Promise<void> {
    try {
      await action()
    } catch (error) {
      if (error instanceof Error && GATE_CONFLICT_ERRORS.has(error.name)) {
        throw new ApiError('conflict', error.message, { status: 409 })
      }

      throw error
    }
  }

  function eventsAfter({ cursor, taskId }: EventQuery) {
    const scope = taskId
      ? and(gt(events.seq, cursor), eq(events.taskId, taskId))
      : gt(events.seq, cursor)

    return db.select().from(events).where(scope).orderBy(asc(events.seq)).limit(200)
  }

  async function eventStream(context: Context, taskId?: string): Promise<Response> {
    if (taskId) {
      await requireTask(taskId)
    }

    const initialCursor = parseEventCursor(context.req.header('last-event-id'))

    return streamSSE(context, async (stream) => {
      let cursor = initialCursor
      let heartbeatAt = now().getTime()

      try {
        while (!stream.aborted && !stream.closed) {
          const rows = await eventsAfter({ cursor, taskId })
          for (const event of rows) {
            await stream.writeSSE({
              id: String(event.seq),
              event: event.type,
              data: JSON.stringify(event),
            })
            cursor = event.seq
          }

          const currentTime = now().getTime()
          if (currentTime - heartbeatAt >= streamSettings.heartbeatIntervalMs) {
            await stream.write(': heartbeat\n\n')
            heartbeatAt = currentTime
          }

          await stream.sleep(streamSettings.pollIntervalMs)
        }
      } catch (error) {
        console.error(error)
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ code: 'internal', detail: 'event stream interrupted' }),
        })
      }
    })
  }

  app.use('*', logger())

  app.onError(handleApiError)

  // Unauthenticated probes — no task data, safe for container healthchecks.
  app.get('/healthz', (c) => c.json({ ok: true }))
  app.get('/readyz', async (c) => {
    try {
      await ping(db)

      return c.json({ ok: true, db: 'up' })
    } catch {
      throw new ApiError('internal', 'database is unavailable', { status: 503 })
    }
  })

  const api = new Hono().use('*', passwordAuth(config.SPECMATE_PASSWORD))

  const routes = api
    .get('/version', (c) =>
      c.json({
        name: 'specmate',
        phase: 0,
        env: config.NODE_ENV,
        revision: process.env.GIT_SHA ?? null,
      }),
    )

    .get('/attention', async (c) => {
      const taskRows = await db.select().from(tasks)
      if (taskRows.length === 0) {
        return c.json({ items: [] })
      }

      const taskIds = taskRows.map((task) => task.id)
      const latestEventRows = await db
        .selectDistinctOn([events.taskId])
        .from(events)
        .where(inArray(events.taskId, taskIds))
        .orderBy(events.taskId, desc(events.seq))
      const failureRows = await db
        .selectDistinctOn([events.taskId])
        .from(events)
        .where(and(inArray(events.taskId, taskIds), eq(events.type, 'task.failed')))
        .orderBy(events.taskId, desc(events.seq))
      const latestEvents = new Map(
        latestEventRows.flatMap((event) => (event.taskId ? [[event.taskId, event] as const] : [])),
      )
      const failures = new Map(
        failureRows.flatMap((event) => (event.taskId ? [[event.taskId, event] as const] : [])),
      )

      const stallCutoff = new Date(now().getTime() - config.SPECMATE_STALL_HOURS * 60 * 60 * 1_000)
      const items: AttentionItem[] = []
      for (const task of taskRows) {
        const latest = latestEvents.get(task.id)
        const taskSummary = {
          id: task.id,
          slug: task.slug,
          title: task.title,
          type: task.type,
          status: task.status,
        }

        if (isHumanGate(task.status) || task.status === 'waiting_human') {
          items.push({
            task: taskSummary,
            reason: { kind: 'gate', detail: `waiting at ${task.status}` },
            since: task.updatedAt,
          })
          continue
        }

        if (task.status === 'failed') {
          const failure = failures.get(task.id)
          const failureReason = failure?.payload.reason
          items.push({
            task: taskSummary,
            reason: {
              kind: 'failed',
              detail: typeof failureReason === 'string' ? failureReason : 'task failed',
            },
            since: failure?.createdAt ?? task.updatedAt,
          })
          continue
        }

        const since = latest?.createdAt ?? task.updatedAt
        if (!isTerminal(task.status) && since < stallCutoff) {
          items.push({
            task: taskSummary,
            reason: {
              kind: 'stalled',
              detail: `no activity for at least ${config.SPECMATE_STALL_HOURS} hours`,
            },
            since,
          })
        }
      }
      items.sort((left, right) => left.since.getTime() - right.since.getTime())

      return c.json({ items })
    })

    .get('/events/stream', (c) => eventStream(c))

    .get('/tasks', async (c) => {
      const rows = await db.select().from(tasks).orderBy(desc(tasks.createdAt)).limit(100)
      return c.json({ tasks: rows })
    })

    .post('/tasks', validator('json', validateJson(CreateTask)), async (c) => {
      const { title, type, repoUrl, baseBranch } = c.req.valid('json')
      const { task } = await createTask(db, {
        slug: `${slugify(title)}-${Bun.randomUUIDv7().slice(0, 8)}`,
        title,
        type,
        repoUrl,
        baseBranch,
      })

      return c.json({ task }, 201)
    })

    .get('/tasks/:id', async (c) => {
      const id = c.req.param('id')
      const task = await requireTask(id)

      const [graph] = await db
        .select()
        .from(runGraphs)
        .where(eq(runGraphs.taskId, task.id))
        .orderBy(desc(runGraphs.version))
        .limit(1)
      const taskStages = graph
        ? await db
            .select()
            .from(stages)
            .where(eq(stages.graphId, graph.id))
            .orderBy(asc(stages.nodeKey), asc(stages.attempt))
        : []

      return c.json({ task, graph: graph ?? null, stages: taskStages.map(serializeStage) })
    })

    .get('/tasks/:id/artifacts', async (c) => {
      const task = await requireTask(c.req.param('id'))
      const rows = await db
        .select({
          id: artifacts.id,
          path: artifacts.path,
          kind: artifacts.kind,
          gitSha: artifacts.gitSha,
          updatedAt: artifacts.updatedAt,
        })
        .from(artifacts)
        .where(eq(artifacts.taskId, task.id))
        .orderBy(asc(artifacts.kind), asc(artifacts.path))

      return c.json({ artifacts: rows })
    })

    .get('/tasks/:id/artifacts/:artifactId', async (c) => {
      const task = await requireTask(c.req.param('id'))
      const [artifact] = await db
        .select({
          id: artifacts.id,
          path: artifacts.path,
          kind: artifacts.kind,
          gitSha: artifacts.gitSha,
          updatedAt: artifacts.updatedAt,
          content: artifacts.snapshotMd,
        })
        .from(artifacts)
        .where(and(eq(artifacts.id, c.req.param('artifactId')), eq(artifacts.taskId, task.id)))
        .limit(1)
      if (!artifact) {
        throw new ApiError('not_found', 'artifact was not found', { status: 404 })
      }

      return c.json({ artifact })
    })

    .post('/tasks/:id/feedback', validator('json', validateJson(CreateComment)), async (c) => {
      const task = await requireTask(c.req.param('id'))
      const input = c.req.valid('json')

      const pinnedStage = input.stageId
        ? (
            await db
              .select()
              .from(stages)
              .where(and(eq(stages.id, input.stageId), eq(stages.taskId, task.id)))
              .limit(1)
          )[0]
        : undefined
      if (input.stageId && !pinnedStage) {
        throw new ApiError('not_found', 'stage was not found for this task', { status: 404 })
      }

      const result = await db.transaction(async (tx) => {
        const [comment] = await tx
          .insert(feedback)
          .values({
            taskId: task.id,
            stageId: pinnedStage?.id,
            role: pinnedStage?.role,
            provider: pinnedStage?.provider,
            kind: 'comment',
            textMd: input.comment,
          })
          .returning()
        if (!comment) {
          throw new ApiError('internal', 'comment could not be recorded', { status: 500 })
        }

        const [event] = await tx
          .insert(events)
          .values({
            taskId: task.id,
            stageId: pinnedStage?.id,
            type: 'feedback.comment',
            payload: {
              feedbackId: comment.id,
              comment: comment.textMd,
              stageId: pinnedStage?.id ?? null,
              nodeKey: pinnedStage?.nodeKey ?? null,
            },
          })
          .returning()
        if (!event) {
          throw new ApiError('internal', 'comment event could not be recorded', { status: 500 })
        }

        return { comment, event }
      })

      return c.json({ feedback: result.comment, event: result.event }, 201)
    })

    .post('/tasks/:id/gates/approve', async (c) => {
      const task = await requireTask(c.req.param('id'))
      await performGateAction(() => gates.approve(task.id, OWNER_ACTOR))

      return c.json({ task: await requireTask(task.id) })
    })

    .post('/tasks/:id/gates/redirect', validator('json', validateJson(GateComment)), async (c) => {
      const task = await requireTask(c.req.param('id'))
      const input = c.req.valid('json')

      await performGateAction(() => gates.redirect(task.id, OWNER_ACTOR, input.comment))

      return c.json({ task: await requireTask(task.id) })
    })

    .post('/tasks/:id/gates/rework', validator('json', validateJson(ReworkGate)), async (c) => {
      const task = await requireTask(c.req.param('id'))
      const input = c.req.valid('json')

      await performGateAction(() =>
        gates.rework({
          taskId: task.id,
          actor: OWNER_ACTOR,
          target: input.target,
          comment: input.comment,
        }),
      )

      return c.json({ task: await requireTask(task.id) })
    })

    .get('/tasks/:id/events/stream', (c) => eventStream(c, c.req.param('id')))

    .get('/tasks/:id/events', async (c) => {
      const id = c.req.param('id')
      const rows = await db
        .select()
        .from(events)
        .where(eq(events.taskId, id))
        .orderBy(desc(events.seq))
        .limit(200)
      return c.json({ events: rows.reverse() })
    })

  return app.route('/api/v1', routes)
}

export type AppType = ReturnType<typeof createApp>
