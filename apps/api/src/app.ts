import {
  appendOwnerMessage,
  ConversationNotFoundError,
  ConversationSubjectConflictError,
  ConversationTaskNotFoundError,
  EmptyConversationMessageError,
  isHumanGate,
  isTerminal,
  listConversations,
  openConversation,
  readConversation,
  TaskState,
  TerminalTaskConversationError,
} from '@specmate/core'
import {
  artifacts,
  conversationActions,
  conversations,
  createConversationStore,
  type Database,
  decisions,
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

export type GateOperations = Pick<
  Engine,
  | 'approve'
  | 'redirect'
  | 'rework'
  | 'confirmAction'
  | 'stopStage'
  | 'restartInterruptedStage'
  | 'answer'
  | 'dismiss'
>

interface StreamSettings {
  pollIntervalMs: number
  heartbeatIntervalMs: number
}

interface EventQuery {
  cursor: number
  taskId?: string
}

interface AttentionItem {
  /** Stable per-row identity: a task carries at most one gate/failed/stalled
   * item but may carry several open decisions, so only the decision item
   * can key off the decision itself. */
  id: string
  task: Pick<Task, 'id' | 'slug' | 'title' | 'type' | 'status'>
  reason: {
    kind: 'gate' | 'decision' | 'failed' | 'stalled'
    detail: string
  }
  since: Date
}

const CreateTask = z.object({
  title: z.string().trim().min(1).max(200),
  description: z
    .string()
    .trim()
    // .max() counts UTF-16 code units, not bytes — this task's request text
    // feeds the ledger's byte-capped budget (packages/runner/src/ledger.ts),
    // so the cap has to be measured the same way or non-Latin scripts could
    // blow the whole budget on this one field.
    .refine((value) => Buffer.byteLength(value, 'utf8') <= 20_000, {
      message: 'description must not exceed 20,000 bytes',
    })
    .optional()
    .transform((value) => (value ? value : undefined)),
  type: z.enum(['feature', 'bugfix']),
  repoUrl: z.url(),
  baseBranch: z.string().trim().min(1).default('main'),
})

const CreateComment = z.object({
  comment: z.string().trim().min(1).max(20_000),
  stageId: z.uuid().optional(),
})

const CreateConversation = z.object({
  subjectKind: z.string().trim().min(1).max(64).optional(),
  subjectId: z.string().trim().min(1).max(200).optional(),
  idempotencyKey: z.string().trim().min(1).max(200),
})

const CreateConversationMessage = z.object({
  message: z.string().trim().min(1).max(20_000),
  idempotencyKey: z.string().trim().min(1).max(200),
})

const GateComment = z.object({
  comment: z.string().trim().min(1).max(20_000),
})

const ReworkGate = GateComment.extend({
  target: TaskState,
})

const AnswerDecision = z
  .object({
    optionId: z.string().trim().min(1).max(200).optional(),
    text: z.string().trim().min(1).max(20_000).optional(),
  })
  .refine((v) => v.optionId || v.text, {
    message: 'optionId or text is required',
    path: ['text'],
  })

const DismissDecision = z.object({
  reason: z.string().trim().max(20_000).optional(),
})

const ConfirmConversationAction = z.object({
  idempotencyKey: z.string().trim().min(1).max(200),
})

const StopStage = z.object({
  stageId: z.uuid(),
  graphId: z.uuid(),
  nodeKey: TaskState,
  attempt: z.number().int().nonnegative(),
})

const RestartStage = z.object({
  stageId: z.uuid(),
  guidance: z.string().trim().max(20_000).optional(),
  idempotencyKey: z.string().trim().min(1).max(200),
})

const GATE_CONFLICT_ERRORS = new Set([
  'GateEdgeError',
  'IllegalTransitionError',
  'NotAtGateError',
  'RedirectCapExhaustedError',
  'ReworkTargetError',
  'StaleTransitionError',
  'ActionConflictError',
  'StageStopConflictError',
  'StageRestartConflictError',
  'DecisionNotOpenError',
  'NoResumeStateError',
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

// hono's validator('json', ...) only parses the body when Content-Type matches
// its JSON regex, silently treating a missing/wrong header as an empty body.
// Ignore the pre-parsed value and read the body ourselves — c.req.json() does
// not gate on the header — so a client that omits it still validates correctly.
function validateJson<T extends z.ZodType>(schema: T) {
  return async (_value: unknown, c: Context): Promise<z.output<T>> => {
    const body = await c.req.json().catch(() => null)
    const parsed = schema.safeParse(body)
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
    acceptedCommit: stage.acceptedCommit,
    startedAt: stage.startedAt,
    finishedAt: stage.finishedAt,
    interruptionCleanupStatus: stage.interruptionCleanupStatus,
    interruptionFailure: stage.interruptionFailure,
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
  const conversationStore = createConversationStore(db)
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

  async function requireDecisionTaskId(decisionId: string): Promise<string> {
    const [row] = await db
      .select({ taskId: decisions.taskId })
      .from(decisions)
      .where(eq(decisions.id, decisionId))
      .limit(1)
    if (!row) {
      throw new ApiError('not_found', 'decision was not found', { status: 404 })
    }

    return row.taskId
  }

  async function performGateAction<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action()
    } catch (error) {
      if (error instanceof Error && error.name === 'DecisionNotFoundError') {
        throw new ApiError('not_found', error.message, { status: 404 })
      }
      if (error instanceof Error && error.name === 'DecisionAnswerEmptyError') {
        throw new ApiError('validation', error.message, {
          status: 400,
          fields: { text: [error.message] },
        })
      }
      if (error instanceof Error && GATE_CONFLICT_ERRORS.has(error.name)) {
        throw new ApiError('conflict', error.message, { status: 409 })
      }

      throw error
    }
  }

  async function performConversationOperation<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      if (error instanceof EmptyConversationMessageError) {
        throw new ApiError('validation', error.message, {
          status: 400,
          fields: { message: [error.message] },
        })
      }
      if (
        error instanceof TerminalTaskConversationError ||
        error instanceof ConversationSubjectConflictError
      ) {
        throw new ApiError('conflict', error.message, { status: 409 })
      }
      if (
        error instanceof ConversationTaskNotFoundError ||
        error instanceof ConversationNotFoundError
      ) {
        throw new ApiError('not_found', error.message, { status: 404 })
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

      const openDecisionRows = await db
        .select({ decision: decisions, task: tasks })
        .from(decisions)
        .innerJoin(tasks, eq(decisions.taskId, tasks.id))
        .where(eq(decisions.status, 'open'))

      const tasksWithOpenDecision = new Set(openDecisionRows.map(({ task }) => task.id))
      const stallCutoff = new Date(now().getTime() - config.SPECMATE_STALL_HOURS * 60 * 60 * 1_000)
      const items: AttentionItem[] = []

      // A decision is its own attention source: it names its own question and
      // the moment it was raised, whether or not it also parked the task.
      for (const { decision, task } of openDecisionRows) {
        items.push({
          id: decision.id,
          task: {
            id: task.id,
            slug: task.slug,
            title: task.title,
            type: task.type,
            status: task.status,
          },
          reason: { kind: 'decision', detail: decision.promptMd },
          since: decision.createdAt,
        })
      }

      for (const task of taskRows) {
        const latest = latestEvents.get(task.id)
        const taskSummary = {
          id: task.id,
          slug: task.slug,
          title: task.title,
          type: task.type,
          status: task.status,
        }

        // waiting_human carries no gate item of its own: REQ-1201 guarantees
        // it has at least one open decision, already covered above. If that
        // invariant is ever violated, fail open here rather than let the
        // task silently vanish from the list — see reportUnexplainedParks.
        if (isHumanGate(task.status)) {
          items.push({
            id: task.id,
            task: taskSummary,
            reason: { kind: 'gate', detail: `waiting at ${task.status}` },
            since: task.updatedAt,
          })
          continue
        }
        if (task.status === 'waiting_human') {
          if (!tasksWithOpenDecision.has(task.id)) {
            items.push({
              id: task.id,
              task: taskSummary,
              reason: { kind: 'gate', detail: 'waiting_human with no open decision on record' },
              since: task.updatedAt,
            })
          }
          continue
        }

        if (task.status === 'failed') {
          const failure = failures.get(task.id)
          const failureReason = failure?.payload.reason
          items.push({
            id: task.id,
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
            id: task.id,
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
      const { title, description, type, repoUrl, baseBranch } = c.req.valid('json')
      const { task } = await createTask(db, {
        slug: `${slugify(title)}-${Bun.randomUUIDv7().slice(0, 8)}`,
        title,
        description,
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

    .post(
      '/tasks/:id/conversations',
      validator('json', validateJson(CreateConversation)),
      async (c) => {
        const input = c.req.valid('json')
        const conversation = await performConversationOperation(() =>
          openConversation(conversationStore, { taskId: c.req.param('id'), ...input }),
        )

        return c.json({ conversation }, 201)
      },
    )

    .get('/tasks/:id/conversations', async (c) => {
      const task = await requireTask(c.req.param('id'))

      return c.json({ conversations: await listConversations(conversationStore, task.id) })
    })

    .post(
      '/tasks/:id/conversations/:conversationId/messages',
      validator('json', validateJson(CreateConversationMessage)),
      async (c) => {
        const task = await requireTask(c.req.param('id'))
        const [conversation] = await db
          .select({ id: conversations.id })
          .from(conversations)
          .where(
            and(
              eq(conversations.id, c.req.param('conversationId')),
              eq(conversations.taskId, task.id),
            ),
          )
          .limit(1)
        if (!conversation) {
          throw new ApiError('not_found', 'conversation was not found for this task', {
            status: 404,
          })
        }
        const result = await performConversationOperation(() =>
          appendOwnerMessage(conversationStore, {
            conversationId: conversation.id,
            content: c.req.valid('json').message,
            idempotencyKey: c.req.valid('json').idempotencyKey,
          }),
        )

        return c.json({ message: result.owner, response: result.response }, 201)
      },
    )

    .get('/tasks/:id/conversations/:conversationId', async (c) => {
      const task = await requireTask(c.req.param('id'))
      const [conversation] = await db
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.id, c.req.param('conversationId')),
            eq(conversations.taskId, task.id),
          ),
        )
        .limit(1)
      if (!conversation) {
        throw new ApiError('not_found', 'conversation was not found for this task', { status: 404 })
      }

      return c.json({
        conversation,
        ...(await readConversation(conversationStore, conversation.id)),
      })
    })

    .post(
      '/tasks/:id/conversations/:conversationId/actions/:actionId/confirm',
      validator('json', validateJson(ConfirmConversationAction)),
      async (c) => {
        const task = await requireTask(c.req.param('id'))
        const [action] = await db
          .select({ id: conversationActions.id })
          .from(conversationActions)
          .where(
            and(
              eq(conversationActions.id, c.req.param('actionId')),
              eq(conversationActions.taskId, task.id),
              eq(conversationActions.conversationId, c.req.param('conversationId')),
            ),
          )
          .limit(1)
        if (!action) {
          throw new ApiError('not_found', 'conversation action was not found', { status: 404 })
        }
        await performGateAction(() =>
          gates.confirmAction({
            taskId: task.id,
            actionId: c.req.param('actionId'),
            actor: OWNER_ACTOR,
            idempotencyKey: c.req.valid('json').idempotencyKey,
          }),
        )

        return c.json({ task: await requireTask(task.id) })
      },
    )

    .post('/tasks/:id/stages/stop', validator('json', validateJson(StopStage)), async (c) => {
      const task = await requireTask(c.req.param('id'))
      const input = c.req.valid('json')
      const result = await performGateAction(() =>
        gates.stopStage({ taskId: task.id, actor: OWNER_ACTOR, ...input }),
      )

      return c.json(result)
    })

    .post('/tasks/:id/stages/restart', validator('json', validateJson(RestartStage)), async (c) => {
      const task = await requireTask(c.req.param('id'))
      const input = c.req.valid('json')
      const restarted = await performGateAction(() =>
        gates.restartInterruptedStage({ taskId: task.id, actor: OWNER_ACTOR, ...input }),
      )

      return c.json({ task: restarted })
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

    .get('/tasks/:id/decisions', async (c) => {
      const task = await requireTask(c.req.param('id'))
      const [decisionRows, conversationRows] = await Promise.all([
        db
          .select()
          .from(decisions)
          .where(eq(decisions.taskId, task.id))
          .orderBy(asc(decisions.createdAt), asc(decisions.id)),
        db
          .select({ id: conversations.id, subjectId: conversations.subjectId })
          .from(conversations)
          .where(and(eq(conversations.taskId, task.id), eq(conversations.subjectKind, 'decision'))),
      ])
      const conversationByDecision = new Map(conversationRows.map((row) => [row.subjectId, row.id]))

      return c.json({
        decisions: decisionRows.map((decision) => ({
          ...decision,
          conversationId: conversationByDecision.get(decision.id) ?? null,
        })),
      })
    })

    .post('/decisions/:id/answer', validator('json', validateJson(AnswerDecision)), async (c) => {
      const decisionId = c.req.param('id')
      const taskId = await requireDecisionTaskId(decisionId)
      const input = c.req.valid('json')
      const task = await performGateAction(() =>
        gates.answer({
          taskId,
          decisionId,
          actor: OWNER_ACTOR,
          optionId: input.optionId,
          text: input.text,
        }),
      )

      return c.json({ task })
    })

    .post('/decisions/:id/dismiss', validator('json', validateJson(DismissDecision)), async (c) => {
      const decisionId = c.req.param('id')
      const taskId = await requireDecisionTaskId(decisionId)
      const input = c.req.valid('json')
      const task = await performGateAction(() =>
        gates.dismiss({ taskId, decisionId, actor: OWNER_ACTOR, reason: input.reason }),
      )

      return c.json({ task })
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
