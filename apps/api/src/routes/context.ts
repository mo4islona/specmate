/**
 * What every route module is handed: the dependencies `createApp` was given,
 * and the handful of operations that are shared across resources — reading a
 * task that must exist, translating a domain error into a response shape,
 * streaming the event log.
 *
 * It exists so the route modules can be split by resource without each of them
 * re-deriving a database handle or a second reading of the same error table. A
 * module destructures what it needs at the top of its factory, which is what
 * keeps the handlers themselves written against plain names.
 */
import {
  ConversationNotFoundError,
  ConversationSubjectConflictError,
  ConversationTaskNotFoundError,
  EmptyConversationMessageError,
  isTerminal,
  TerminalTaskConversationError,
} from '@specmate/core'
import {
  createConversationStore,
  type Database,
  decisions,
  events,
  runGraphs,
  stages,
  type Task,
  tasks,
} from '@specmate/db'
import { githubToken, ReferenceReader, RepositoryProber } from '@specmate/github'
import type { Engine } from '@specmate/orchestrator/engine'
import {
  GitError,
  resolveWorkspaceConfig,
  type WorkspaceConfig,
  type WorkspaceService,
} from '@specmate/workspace'
import { and, asc, desc, eq, gt, sql } from 'drizzle-orm'
import type { Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { Config } from '../config.ts'
import { ApiError } from '../errors.ts'

export interface AppDeps {
  db: Database
  config: Config
  gates: GateOperations
  workspace: WorkspaceDiffOperations
  /** Injected so a test never reaches GitHub; the default reads under the stored credential. */
  references?: ReferenceReads
  repositoryProbes?: RepositoryProbes
  now?: () => Date
  stream?: Partial<StreamSettings>
}

export type ReferenceReads = Pick<ReferenceReader, 'read'>
export type RepositoryProbes = Pick<RepositoryProber, 'probe'>

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

export type WorkspaceDiffOperations = Pick<WorkspaceService, 'diffFiles' | 'diffFile'>

export interface StreamSettings {
  pollIntervalMs: number
  heartbeatIntervalMs: number
}

interface EventQuery {
  cursor: number
  taskId?: string
}

export const OWNER_ACTOR = 'owner'

const GATE_CONFLICT_ERRORS = new Set([
  'GateEdgeError',
  'IllegalTransitionError',
  'NotAtGateError',
  'RedirectCapExhaustedError',
  'ReworkTargetError',
  'SkippedTargetError',
  'StaleTransitionError',
  'ActionConflictError',
  'StageStopConflictError',
  'StageRestartConflictError',
  'DecisionNotOpenError',
  'NoResumeStateError',
  'CoverageDecisionRequiresOptionError',
  'BudgetDecisionRequiresOptionError',
  'BudgetRaiseTooLowError',
  'NotParkedError',
])

export function parseEventCursor(value: string | undefined): number {
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

/**
 * REQ-1018: every timeline read is a page of up to 200 events, so an activity
 * event's whole patch is dropped here and fetched per event instead. The
 * clamped preview beside it is what the run log draws.
 */
export const eventColumns = {
  seq: events.seq,
  taskId: events.taskId,
  stageId: events.stageId,
  type: events.type,
  payload: sql<Record<string, unknown>>`${events.payload} #- '{edit,patch}'`.as('payload'),
  createdAt: events.createdAt,
}

export type RouteContext = ReturnType<typeof createRouteContext>

export function createRouteContext({
  db,
  config,
  gates,
  workspace,
  references,
  repositoryProbes: probes,
  now = () => new Date(),
  stream: streamOverrides,
}: AppDeps) {
  const conversationStore = createConversationStore(db)
  const workspaceConfig: WorkspaceConfig = resolveWorkspaceConfig({ root: config.WORKSPACE_ROOT })

  // One reader for the process, so its cache is shared by every request rather
  // than rebuilt per call — which is the whole point of caching a lookup that a
  // debounced field fires repeatedly (AC-1072).
  const credential = () =>
    githubToken({ db, clientId: config.GITHUB_APP_CLIENT_ID }).catch(() => null)
  const referenceReads: ReferenceReads = references ?? new ReferenceReader({ token: credential })
  const repositoryProbes: RepositoryProbes = probes ?? new RepositoryProber({ token: credential })
  const streamSettings: StreamSettings = {
    pollIntervalMs: 1_000,
    heartbeatIntervalMs: 15_000,
    ...streamOverrides,
  }

  async function requireTask(id: string): Promise<Task> {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1)
    if (!task) {
      throw new ApiError('not_found', 'task was not found', { status: 404 })
    }

    return task
  }

  /**
   * The node an unpinned comment is addressed to (REQ-1008): the one running
   * now, or the next one that has yet to run. Derived here rather than asked of
   * the caller — a destination the owner picks from a list is the control this
   * change removed, and the client's own reading of the state must not be what
   * decides where the text lands.
   */
  async function addressedNode(task: Task): Promise<{ graphId: string; nodeKey: string } | null> {
    if (isTerminal(task.status)) return null

    const [graph] = await db
      .select()
      .from(runGraphs)
      .where(eq(runGraphs.taskId, task.id))
      .orderBy(desc(runGraphs.version))
      .limit(1)
    if (!graph) return null

    const [running] = await db
      .select({ nodeKey: stages.nodeKey })
      .from(stages)
      .where(and(eq(stages.taskId, task.id), eq(stages.status, 'running')))
      .limit(1)
    if (running) return { graphId: graph.id, nodeKey: running.nodeKey }

    // An interrupted task resumes into the node it stopped in, and that node already
    // has an attempt on record — the never-started scan below would step over it and
    // address the one after.
    if (task.resumeStatus) return { graphId: graph.id, nodeKey: task.resumeStatus }

    const run = await db
      .select({ nodeKey: stages.nodeKey })
      .from(stages)
      .where(eq(stages.taskId, task.id))
    const started = new Set(run.map((row) => row.nodeKey))
    const next = graph.dag.nodes.find((node) => node.kind === 'stage' && !started.has(node.key))

    return next ? { graphId: graph.id, nodeKey: next.key } : null
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
      if (error instanceof Error && error.name === 'BudgetRaiseValueError') {
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

  /**
   * A branch or commit that no longer resolves — the task was never
   * provisioned, a repo host deleted it externally, or its history was
   * rewritten out from under the task branch — is a not-found response, not
   * a crash (`task-surface` REQ-1010's error-shape rule, `code-diff-view`
   * design's Risks section: "a pre-existing possibility for any git-history
   * read").
   */
  async function performDiffOperation<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === 'TaskBranchMissingError' || error.name === 'BaseBranchMissingError')
      ) {
        throw new ApiError('not_found', error.message, { status: 404 })
      }
      // GitError's own message embeds the mirror's absolute filesystem path
      // and raw stderr — never forwarded to the client, and not assumed to
      // mean "not found": it also covers a transient fetch/network failure.
      if (error instanceof GitError) {
        throw new ApiError('not_found', 'task branch history is not resolvable', { status: 404 })
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

    return db.select(eventColumns).from(events).where(scope).orderBy(asc(events.seq)).limit(200)
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

  return {
    db,
    config,
    gates,
    workspace,
    referenceReads,
    repositoryProbes,
    now,
    workspaceConfig,
    conversationStore,
    requireTask,
    addressedNode,
    requireDecisionTaskId,
    performGateAction,
    performDiffOperation,
    performConversationOperation,
    eventsAfter,
    eventStream,
  }
}
