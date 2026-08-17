import {
  advance,
  bindStageProvider,
  blockingOpen,
  type Caps,
  type ConversationActionOption,
  type ConversationActionProposal,
  canTransition,
  type DecisionOption,
  decisionFromRequest,
  type EscalationInput,
  type ExecutionUsage,
  escalationForPark,
  type GateNode,
  isRestartable,
  isTerminal,
  LOOP_CAPS,
  nodeAt,
  type PinnedGraph,
  type ProviderId,
  RESERVED_STATES,
  type RecordedRound,
  ROLE_CONTRACTS,
  type RoundToRecord,
  renderDecisionLog,
  type StageNode,
  type StageTelemetry,
  stalledFindings,
  type TaskState,
  TERMINAL_STATES,
} from '@specmate/core'
import {
  type ConversationAction,
  type ConversationMessage,
  conversationActions,
  conversationMessages,
  conversations,
  type Database,
  type DbClient,
  decisions,
  feedback,
  type Stage,
  type StageUsage,
  stages,
  type Task,
  tasks,
} from '@specmate/db'
import type { ConversationExecution, StageExecution } from '@specmate/runner'
import type { ConversationWorkspace, StageCommit, StageRef, Workspace } from '@specmate/workspace'
import { and, asc, count, desc, eq, inArray, lt, notInArray, or, sql } from 'drizzle-orm'
import {
  countRedirects,
  emitEvent,
  lastRestartAt,
  lastReworkAt,
  latestGraph,
  latestGraphsFor,
  type RunGraphRow,
  raiseDecision,
  recordRound,
  roundsFor,
  TaskNotFoundError,
} from './store.ts'

export class NotAtGateError extends Error {
  constructor(taskId: string, status: TaskState) {
    super(`task ${taskId} is at ${status}, which is not a gate of its pinned pipeline`)
    this.name = 'NotAtGateError'
  }
}

export class GateEdgeError extends Error {
  constructor(gate: TaskState, edge: string) {
    super(`gate ${gate} does not declare a ${edge} edge`)
    this.name = 'GateEdgeError'
  }
}

export class ReworkTargetError extends Error {
  constructor(gate: TaskState, target: TaskState) {
    super(`gate ${gate} does not declare ${target} as a rework target`)
    this.name = 'ReworkTargetError'
  }
}

export class RedirectCapExhaustedError extends Error {
  constructor(gate: TaskState, cap: string, limit: number) {
    super(`gate ${gate} has used its ${limit} redirect(s) (${cap}); a decision is required`)
    this.name = 'RedirectCapExhaustedError'
  }
}

export class NotParkedError extends Error {
  constructor(taskId: string, status: TaskState) {
    super(`task ${taskId} is ${status}, not parked`)
    this.name = 'NotParkedError'
  }
}

export class NotRestartableError extends Error {
  constructor(taskId: string, status: TaskState) {
    super(`task ${taskId} is ${status}; only a failed task can be restarted`)
    this.name = 'NotRestartableError'
  }
}

export class RestartTargetError extends Error {
  constructor(taskId: string, target: TaskState, failedAt: TaskState) {
    super(`task ${taskId} failed at ${failedAt}; ${target} is not that stage or an earlier one`)
    this.name = 'RestartTargetError'
  }
}

export class NoResumeStateError extends Error {
  constructor(taskId: string) {
    super(`task ${taskId} has no recorded resume state`)
    this.name = 'NoResumeStateError'
  }
}

export class IllegalTransitionError extends Error {
  constructor(taskId: string, from: TaskState, to: TaskState) {
    super(`task ${taskId} may not move ${from} → ${to} under its pinned pipeline`)
    this.name = 'IllegalTransitionError'
  }
}

export class StaleTransitionError extends Error {
  constructor(taskId: string, from: TaskState, to: TaskState) {
    super(
      `task ${taskId} left ${from} while ${from} → ${to} was in flight; the transition no longer applies`,
    )
    this.name = 'StaleTransitionError'
  }
}

export class StageStopConflictError extends Error {
  override readonly name = 'StageStopConflictError'

  constructor(stageId: string) {
    super(`stage ${stageId} is no longer the exact running attempt`)
  }
}

export class StageRestartConflictError extends Error {
  override readonly name = 'StageRestartConflictError'

  constructor(stageId: string) {
    super(`stage ${stageId} is not a safely cleaned interrupted attempt`)
  }
}

export class StopCleanupError extends Error {
  override readonly name = 'StopCleanupError'

  constructor(stageId: string, detail: string) {
    super(`stage ${stageId} stopped but cleanup failed: ${detail}`)
  }
}

export class ActionConflictError extends Error {
  override readonly name = 'ActionConflictError'

  constructor(actionId: string, detail: string) {
    super(`action ${actionId} conflicts with live task state: ${detail}`)
  }
}

export class DecisionNotFoundError extends Error {
  override readonly name = 'DecisionNotFoundError'

  constructor(decisionId: string) {
    super(`decision ${decisionId} does not exist`)
  }
}

export class DecisionNotOpenError extends Error {
  override readonly name = 'DecisionNotOpenError'

  constructor(decisionId: string, status: string) {
    super(`decision ${decisionId} is ${status}, not open`)
  }
}

export class DecisionAnswerEmptyError extends Error {
  override readonly name = 'DecisionAnswerEmptyError'

  constructor(decisionId: string) {
    super(`decision ${decisionId} was answered with neither an option nor text`)
  }
}

/** What the engine needs from the workspace layer; the entry point adapts `WorkspaceService`. */
export interface EngineWorkspaces {
  provision(request: {
    taskId: string
    slug: string
    repoUrl: string
    baseBranch: string
  }): Promise<Workspace>
  provisionConversation(workspace: Workspace, key: string): Promise<ConversationWorkspace>
  releaseConversation(task: { slug: string; repoUrl: string }, key: string): Promise<void>
  discard(workspace: Workspace, commit?: string): Promise<void>
  headCommit?(workspace: Workspace): Promise<string>
  commitStage?(taskId: string, workspace: Workspace, stage: StageRef): Promise<StageCommit>
  /** Absent in ops-only contexts (the admin CLI), which never dispatch a stage. */
  writeDecisionLog?(workspace: Workspace, markdown: string): Promise<void>
  release(taskId: string): Promise<void>
}

export interface StageDispatch {
  readonly task: Task
  readonly graphId: string
  readonly dag: PinnedGraph
  readonly node: StageNode
  readonly stageId: string
  readonly attempt: number
  readonly provider: ProviderId
  readonly workspace: Workspace
}

export type StageDispatcher = (dispatch: StageDispatch) => Promise<StageExecution>

export interface ConversationDispatch {
  readonly task: Task
  readonly conversationId: string
  readonly response: ConversationMessage
  readonly ownerMessage: ConversationMessage
  readonly context: string
  readonly previousAnchorCommit: string | null
  readonly previousTaskState: TaskState | null
  readonly currentAnchorCommit: string
  readonly currentTaskState: TaskState
  readonly contextPath: 'stored' | 'cached' | 'reconstructed' | 'none'
  readonly actionOptions: readonly ConversationActionOption[]
  readonly attempt: number
  readonly provider: ProviderId
  readonly startedAt: Date
  readonly workspace: ConversationWorkspace
}

export type ConversationDispatcher = (
  dispatch: ConversationDispatch,
) => Promise<ConversationExecution>

interface ConversationRunContext {
  readonly task: Task
  readonly conversationId: string
  readonly response: ConversationMessage
  readonly ownerMessage: ConversationMessage
  readonly context: string
  readonly previousAnchorCommit: string | null
  readonly previousTaskState: TaskState | null
  readonly contextPath: 'stored' | 'cached' | 'reconstructed' | 'none'
  readonly provider: ProviderId
  readonly startedAt: Date
}

export interface EngineSettings {
  readonly stageConcurrency: number
  readonly stageAttemptCap: number
  readonly availableProviders: readonly ProviderId[]
  readonly conversationConcurrency?: number
}

export interface ReworkOptions {
  readonly taskId: string
  readonly actor: string
  readonly target: TaskState
  readonly comment?: string
}

export interface AnswerDecisionOptions {
  readonly taskId: string
  readonly decisionId: string
  readonly actor: string
  readonly optionId?: string
  readonly text?: string
}

export interface DismissDecisionOptions {
  readonly taskId: string
  readonly decisionId: string
  readonly actor: string
  readonly reason?: string
}

export interface StopStageOptions {
  readonly taskId: string
  readonly stageId: string
  readonly graphId: string
  readonly nodeKey: string
  readonly attempt: number
  readonly actor: string
}

export interface RestartInterruptedStageOptions {
  readonly taskId: string
  readonly stageId: string
  readonly actor: string
  readonly guidance?: string
  readonly idempotencyKey: string
  readonly actionId?: string
}

export interface ConfirmActionOptions {
  readonly taskId: string
  readonly actionId: string
  readonly actor: string
  readonly idempotencyKey: string
}

export interface EngineDeps {
  readonly db: Database
  readonly workspaces: EngineWorkspaces
  readonly settings: EngineSettings
  /** Absent in ops-only contexts (the admin CLI); tick() requires it. */
  readonly dispatcher?: StageDispatcher
  /** Answer-only runs use a disposable task snapshot and never enter the pinned graph. */
  readonly conversationDispatcher?: ConversationDispatcher
  /** Kills executions found by label during the sweep; absent means nothing to kill. */
  readonly killOrphans?: (labels: Record<string, string>) => Promise<string[]>
  readonly log?: (message: string) => void
}

/**
 * Statuses the poll never dispatches from: interrupts, terminals, and the
 * drafting board — the same reserved list `validateDefinition` uses to keep a
 * pipeline node from claiming one of these statuses as its own key.
 */
const NOT_RUNNABLE: TaskState[] = [...RESERVED_STATES]

const CONVERSATION_ATTEMPT_CAP = 2

/** Below this age a 'failed' interruption cleanup might still be the retry that's currently running; above it, the next sweep tries again. */
const INTERRUPTION_CLEANUP_RETRY_MS = 60_000

/** An action can only sit in 'applying' while a single confirmAction call is on the stack; past this age that call has crashed. */
const STUCK_ACTION_TIMEOUT_MS = 5 * 60_000

/**
 * The loop. Picks up runnable tasks, walks each along its pinned graph through
 * dispatch → outcome → advance, and exposes the gate operations the future UI
 * will call. Deliberately free of role-, type-, or node-specific branching:
 * anything that wants to branch must become definition data.
 */
export class Engine {
  private readonly inFlight = new Set<Promise<void>>()
  private readonly stageRuns = new Map<string, Promise<void>>()

  constructor(private readonly deps: EngineDeps) {}

  /** Waits for every dispatched stage or answer to settle; tests and shutdown use this. */
  async idle(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.allSettled([...this.inFlight])
  }

  /**
   * One poll: reconcile terminal queues, dispatch runnable stages, then use a
   * separate response pool for idle tasks. Conversation snapshots never consume stage
   * slots, so newly runnable pipeline work can always overtake an answer.
   */
  async tick(): Promise<number> {
    const { conversationDispatcher, db, settings, dispatcher } = this.deps
    if (!dispatcher) throw new Error('this engine has no dispatcher; tick() is not available')

    await this.recoverPendingInterruptions()
    await this.recoverStuckActions()
    await this.failTerminalQueuedResponses()

    const [[runningStages], [runningResponses]] = await Promise.all([
      db.select({ n: count() }).from(stages).where(eq(stages.status, 'running')),
      db
        .select({ n: count() })
        .from(conversationMessages)
        .where(eq(conversationMessages.status, 'responding')),
    ])
    const stageSlots = settings.stageConcurrency - (runningStages?.n ?? 0)
    const responseSlots =
      (settings.conversationConcurrency ?? settings.stageConcurrency) - (runningResponses?.n ?? 0)
    let dispatched = 0
    let stagesDispatched = 0
    if (stageSlots > 0) {
      const candidates = await db
        .select()
        .from(tasks)
        .where(notInArray(tasks.status, NOT_RUNNABLE))
        .orderBy(asc(tasks.updatedAt))

      const graphs = await latestGraphsFor(
        db,
        candidates.map((task) => task.id),
      )
      const runnable: { task: Task; graph: RunGraphRow; node: StageNode }[] = []
      for (const task of candidates) {
        const graph = graphs.get(task.id)
        if (!graph) continue
        const node = nodeAt(graph.dag, task.status)
        if (node?.kind !== 'stage') continue
        runnable.push({ task, graph, node })
      }
      const dispatchable = await Promise.all(
        runnable.map(async (candidate) => ({
          ...candidate,
          provider: await this.resolveProvider(candidate.graph, candidate.node),
        })),
      )

      for (const { task, graph, node, provider } of dispatchable) {
        if (stagesDispatched >= stageSlots) break
        const claimed = await this.claim(task, graph, node, provider)
        if (!claimed) continue

        dispatched += 1
        stagesDispatched += 1
        const run = this.runStage(task, graph, node, claimed, dispatcher)
          .catch((e: Error) => {
            this.deps.log?.(
              `stage ${task.id}/${node.key} attempt ${claimed.attempt} did not settle: ${e.message}`,
            )
          })
          .finally(() => {
            this.inFlight.delete(run)
            if (this.stageRuns.get(claimed.id) === run) this.stageRuns.delete(claimed.id)
          })
        this.inFlight.add(run)
        this.stageRuns.set(claimed.id, run)
      }
    }

    if (responseSlots <= 0) return dispatched

    const pending = await db
      .select({ response: conversationMessages, conversation: conversations, task: tasks })
      .from(conversationMessages)
      .innerJoin(conversations, eq(conversationMessages.conversationId, conversations.id))
      .innerJoin(tasks, eq(conversations.taskId, tasks.id))
      .where(eq(conversationMessages.status, 'queued'))
      .orderBy(
        asc(conversationMessages.createdAt),
        asc(conversationMessages.sequence),
        asc(conversationMessages.id),
      )
    if (pending.length > 0 && !conversationDispatcher) {
      throw new Error('this engine has no conversation dispatcher; queued responses cannot run')
    }

    const consideredConversations = new Set<string>()
    let responsesDispatched = 0
    for (const candidate of pending) {
      if (responsesDispatched >= responseSlots) break
      if (consideredConversations.has(candidate.conversation.id)) continue
      consideredConversations.add(candidate.conversation.id)
      if (isTerminal(candidate.task.status)) continue

      const provider = this.resolveAnswerProvider()
      const claimed = await this.claimResponse(candidate.response, provider)
      if (!claimed || !conversationDispatcher) continue
      const [ownerMessage] = await db
        .select()
        .from(conversationMessages)
        .where(eq(conversationMessages.id, claimed.replyToMessageId ?? ''))
        .limit(1)
      if (!ownerMessage) throw new Error(`response ${claimed.id} has no owner message`)

      const context = await this.conversationContext(
        candidate.conversation.id,
        ownerMessage.sequence,
      )

      const startedAt = new Date()
      dispatched += 1
      responsesDispatched += 1
      const run = this.runConversation(
        {
          task: candidate.task,
          conversationId: candidate.conversation.id,
          response: claimed,
          ownerMessage,
          context: context.text,
          previousAnchorCommit: candidate.conversation.contextCommit,
          previousTaskState: candidate.conversation.contextTaskState,
          contextPath: context.path,
          provider,
          startedAt,
        },
        conversationDispatcher,
      )
        .catch((error: Error) => {
          this.deps.log?.(
            `conversation response ${claimed.id} attempt ${claimed.telemetry.length} did not settle: ${error.message}`,
          )
        })
        .finally(() => {
          this.inFlight.delete(run)
        })
      this.inFlight.add(run)
    }

    return dispatched
  }

  private async failTerminalQueuedResponses(taskId?: string): Promise<void> {
    const rows = await this.deps.db
      .select({
        response: conversationMessages,
        task: tasks,
      })
      .from(conversationMessages)
      .innerJoin(conversations, eq(conversationMessages.conversationId, conversations.id))
      .innerJoin(tasks, eq(conversations.taskId, tasks.id))
      .where(
        and(
          eq(conversationMessages.status, 'queued'),
          inArray(tasks.status, [...TERMINAL_STATES]),
          taskId ? eq(tasks.id, taskId) : undefined,
        ),
      )

    for (const { response, task } of rows) {
      let cleaned = true
      for (let attempt = 0; attempt < response.telemetry.length; attempt += 1) {
        await this.deps.workspaces
          .releaseConversation(task, `${response.id}-${attempt}`)
          .catch((error: Error) => {
            cleaned = false
            this.deps.log?.(`terminal response ${response.id} cleanup failed: ${error.message}`)
          })
      }
      if (!cleaned) continue

      await this.deps.db.transaction(async (tx) => {
        const [failed] = await tx
          .update(conversationMessages)
          .set({
            status: 'failed',
            failureReason: `task became ${task.status}`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(conversationMessages.id, response.id),
              eq(conversationMessages.status, 'queued'),
            ),
          )
          .returning({ id: conversationMessages.id })
        if (!failed) return

        await emitEvent(tx, {
          taskId: task.id,
          type: 'conversation.response.failed',
          payload: {
            conversationId: response.conversationId,
            messageId: response.id,
            reason: `task became ${task.status}`,
          },
        })
      })
    }
  }

  /**
   * The claim is transactional: the advisory lock makes an accidental second
   * orchestrator skip rather than double-dispatch, and the (graph, node,
   * attempt) unique index is the arbiter if even that fails. The attempt cap
   * is checked here too, in the same transaction as the insert — a stage that
   * just failed its last attempt must not be re-dispatched by a tick that
   * beats `failAttempt`'s own cap check to the punch.
   */
  private async claim(
    task: Task,
    graph: RunGraphRow,
    node: StageNode,
    provider: ProviderId,
  ): Promise<Stage | null> {
    return this.deps.db.transaction(async (tx) => {
      const locked = await tx.execute(
        sql`select pg_try_advisory_xact_lock(hashtextextended(${task.id}, 0)) as locked`,
      )
      const [lock] = locked as { locked?: boolean }[]
      if (!lock?.locked) return null

      // The candidate list is a snapshot; between it and this lock the task
      // may have been cancelled, parked, or advanced. Only the live status
      // may dispatch.
      const [current] = await tx
        .select({ status: tasks.status })
        .from(tasks)
        .where(eq(tasks.id, task.id))
        .limit(1)
      if (current?.status !== node.key) return null

      const inFlight = await tx
        .select({ id: stages.id })
        .from(stages)
        .where(and(eq(stages.taskId, task.id), eq(stages.status, 'running')))
        .limit(1)
      if (inFlight.length > 0) return null

      const history = await this.attemptHistory(tx, task.id, graph.id, node.key)
      if (history.streak >= this.deps.settings.stageAttemptCap) return null
      const [row] = await tx
        .insert(stages)
        .values({
          taskId: task.id,
          graphId: graph.id,
          nodeKey: node.key,
          role: node.role,
          provider,
          status: 'running',
          attempt: history.lastAttempt + 1,
          startedAt: new Date(),
        })
        .returning()

      if (row) {
        await tx
          .update(feedback)
          .set({ consumedByStageId: row.id })
          .where(
            and(
              eq(feedback.taskId, task.id),
              eq(feedback.kind, 'intervention'),
              sql`${feedback.consumedByStageId} is null`,
              sql`${feedback.target}->>'nodeKey' = ${node.key}`,
            ),
          )
      }

      return row ?? null
    })
  }

  /**
   * The cross-provider rule needs to know who wrote the artifacts under
   * review: the provider recorded on the last successful run of the loop
   * edge's target — the stage this review loops back to.
   */
  private async resolveProvider(graph: RunGraphRow, node: StageNode): Promise<ProviderId> {
    let writer: ProviderId | undefined
    if (node.binding === 'cross_review' && node.loopEdge) {
      const [written] = await this.deps.db
        .select({ provider: stages.provider })
        .from(stages)
        .where(
          and(
            eq(stages.graphId, graph.id),
            eq(stages.nodeKey, node.loopEdge.target),
            eq(stages.status, 'succeeded'),
          ),
        )
        .orderBy(desc(stages.attempt))
        .limit(1)
      writer = written?.provider
    }

    return bindStageProvider(node, writer, this.deps.settings.availableProviders)
  }

  private resolveAnswerProvider(): ProviderId {
    const preferred = ROLE_CONTRACTS.answerer.defaultProvider
    if (this.deps.settings.availableProviders.includes(preferred)) return preferred

    const fallback = this.deps.settings.availableProviders[0]
    if (!fallback) throw new Error('no provider is available for answer-only runs')

    return fallback
  }

  /** Claims FIFO per conversation without taking ownership of the task workspace. */
  private async claimResponse(
    candidate: ConversationMessage,
    provider: ProviderId,
  ): Promise<ConversationMessage | null> {
    return this.deps.db.transaction(async (tx) => {
      const locked = await tx.execute(
        sql`select pg_try_advisory_xact_lock(hashtextextended(${candidate.conversationId}, 0)) as locked`,
      )
      const [lock] = locked as { locked?: boolean }[]
      if (!lock?.locked) return null

      // The queue scan is only a snapshot. Re-check the owning task under the
      // conversation lock so a terminal transition cannot race into a new run.
      const [owner] = await tx
        .select({ taskStatus: tasks.status })
        .from(conversations)
        .innerJoin(tasks, eq(conversations.taskId, tasks.id))
        .where(eq(conversations.id, candidate.conversationId))
        .limit(1)
      if (!owner || isTerminal(owner.taskStatus)) return null

      const [runningResponse] = await tx
        .select({ id: conversationMessages.id })
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.conversationId, candidate.conversationId),
            eq(conversationMessages.status, 'responding'),
          ),
        )
        .limit(1)
      if (runningResponse) return null

      const [claimed] = await tx
        .update(conversationMessages)
        .set({ status: 'responding', provider, updatedAt: new Date() })
        .where(
          and(eq(conversationMessages.id, candidate.id), eq(conversationMessages.status, 'queued')),
        )
        .returning()

      return claimed ?? null
    })
  }

  private async conversationContext(
    conversationId: string,
    throughSequence: number,
  ): Promise<{ text: string; path: 'stored' | 'reconstructed' | 'none' }> {
    const [conversation] = await this.deps.db
      .select({ summaryMd: conversations.summaryMd, summaryThrough: conversations.summaryThrough })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1)
    const summaryThrough = conversation?.summaryMd ? conversation.summaryThrough : 0
    const rows = await this.deps.db
      .select()
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.conversationId, conversationId),
          sql`${conversationMessages.sequence} > ${summaryThrough}`,
          sql`${conversationMessages.sequence} < ${throughSequence}`,
          sql`${conversationMessages.status} <> 'queued'`,
        ),
      )
      .orderBy(asc(conversationMessages.sequence))

    const transcript = rows
      .map(
        (message) =>
          `## ${message.role} #${message.sequence} (task: ${message.taskState}; commit: ${message.contextCommit ?? 'none'})\n\n${message.contentMd}`,
      )
      .join('\n\n')
    const summary = conversation?.summaryMd
      ? `## Stored summary through #${conversation.summaryThrough}\n\n${conversation.summaryMd}`
      : ''

    // A stored summary is always used when present, even alongside a transcript
    // tail; a bare transcript with no summary was built fresh from raw
    // messages; neither present means this is the conversation's first turn.
    const path = conversation?.summaryMd ? 'stored' : transcript ? 'reconstructed' : 'none'

    return { text: [summary, transcript].filter(Boolean).join('\n\n'), path }
  }

  private async runConversation(
    context: ConversationRunContext,
    dispatcher: ConversationDispatcher,
  ): Promise<void> {
    const { task, response, provider, startedAt } = context
    const { workspaces } = this.deps
    let workspace: ConversationWorkspace | undefined
    let currentTaskState = task.status
    let preparationFailure: ConversationExecution['failure'] = 'cleanup_failed'
    let execution: ConversationExecution
    try {
      for (let priorAttempt = 0; priorAttempt < response.telemetry.length; priorAttempt += 1) {
        await workspaces.releaseConversation(task, `${response.id}-${priorAttempt}`)
      }
      preparationFailure = 'provider_error'
      const primary = await workspaces.provision({
        taskId: task.id,
        slug: task.slug,
        repoUrl: task.repoUrl,
        baseBranch: task.baseBranch,
      })
      workspace = await workspaces.provisionConversation(
        primary,
        `${response.id}-${response.telemetry.length}`,
      )
      const [liveTask] = await this.deps.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, task.id))
        .limit(1)
      const currentTask = liveTask ?? task
      currentTaskState = currentTask.status
      const actionOptions = await this.conversationActionOptions(currentTask)
      await this.deps.db
        .update(conversationMessages)
        .set({
          contextCommit: workspace.branch,
          taskState: currentTaskState,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(conversationMessages.id, response.id),
            eq(conversationMessages.status, 'responding'),
          ),
        )
      execution = await dispatcher({
        task,
        conversationId: context.conversationId,
        response,
        ownerMessage: context.ownerMessage,
        context: context.context,
        previousAnchorCommit: context.previousAnchorCommit,
        previousTaskState: context.previousTaskState,
        currentAnchorCommit: workspace.branch,
        currentTaskState,
        contextPath: context.contextPath,
        actionOptions,
        attempt: response.telemetry.length,
        provider,
        startedAt,
        workspace,
      })
    } catch (error) {
      execution = {
        status: 'failed',
        failure: preparationFailure,
        detail: (error as Error).message,
        durationMs: Date.now() - startedAt.getTime(),
      }
    }

    if (workspace) {
      try {
        await workspaces.releaseConversation(task, workspace.key)
      } catch (error) {
        // A teardown failure is real but must not launder over an already-good
        // answer: replacing a succeeded execution here would discard a valid
        // reply and burn attempt budget for work that already finished.
        if (execution.status !== 'succeeded') {
          execution = {
            status: 'failed',
            failure: 'cleanup_failed',
            detail: (error as Error).message,
            durationMs: execution.durationMs,
            telemetry: execution.telemetry,
          }
        } else {
          this.deps.log?.(
            `conversation response ${response.id} succeeded but workspace cleanup failed: ${(error as Error).message}`,
          )
        }
      }
    }

    const finishedAt = new Date()
    const defect = conversationDefect(execution)
    const telemetry = conversationUsage({
      provider,
      startedAt,
      finishedAt,
      execution,
      defect,
      contextPath: context.contextPath,
    })
    if (!defect && execution.message) {
      await this.completeConversationResponse(
        context,
        execution,
        telemetry,
        workspace?.branch ?? null,
        currentTaskState,
      )

      return
    }

    const reason = defect?.reason ?? 'missing_message'
    const detail = defect?.detail
    const attempts = [...response.telemetry, telemetry]
    if (attempts.length >= CONVERSATION_ATTEMPT_CAP) {
      await this.deps.db.transaction(async (tx) => {
        await tx
          .update(conversationMessages)
          .set({
            status: 'failed',
            failureReason: detail ? `${reason}: ${detail}` : reason,
            telemetry: attempts,
            updatedAt: finishedAt,
          })
          .where(eq(conversationMessages.id, response.id))
        await emitEvent(tx, {
          taskId: task.id,
          type: 'conversation.response.failed',
          payload: {
            conversationId: response.conversationId,
            messageId: response.id,
            reason,
            detail: detail ?? null,
          },
        })
      })

      return
    }

    await this.deps.db
      .update(conversationMessages)
      .set({ status: 'queued', telemetry: attempts, failureReason: null, updatedAt: finishedAt })
      .where(eq(conversationMessages.id, response.id))
  }

  private async conversationActionOptions(task: Task): Promise<ConversationActionOption[]> {
    const graph = await latestGraph(this.deps.db, task.id)
    if (!graph) return []

    const [openDecisions, interruptedStages] = await Promise.all([
      this.deps.db
        .select({
          id: decisions.id,
          promptMd: decisions.promptMd,
          options: decisions.options,
        })
        .from(decisions)
        .where(and(eq(decisions.taskId, task.id), eq(decisions.status, 'open')))
        .orderBy(asc(decisions.createdAt)),
      task.status === 'paused' && task.resumeStatus
        ? this.deps.db
            .select()
            .from(stages)
            .where(
              and(
                eq(stages.taskId, task.id),
                eq(stages.graphId, graph.id),
                eq(stages.nodeKey, task.resumeStatus),
                eq(stages.status, 'interrupted'),
                eq(stages.interruptionCleanupStatus, 'succeeded'),
              ),
            )
            .orderBy(desc(stages.attempt))
            .limit(1)
        : Promise.resolve([]),
    ])
    const expectedTask = { taskStatus: task.status, graphId: graph.id }
    const actionOptions: ConversationActionOption[] = []

    for (const decision of openDecisions) {
      const choices = decision.options.map((option) => `${option.id}: ${option.label}`).join('; ')
      const description = choices
        ? `Answer the open decision: ${decision.promptMd} Options: ${choices}`
        : `Answer the open decision: ${decision.promptMd}`
      const target = { taskId: task.id, graphId: graph.id, decisionId: decision.id }
      const expectedVersion = { ...expectedTask, decisionStatus: 'open' }
      actionOptions.push(
        {
          kind: 'answer_decision',
          target,
          expectedVersion,
          instruction: 'required',
          description,
        },
        {
          kind: 'dismiss_decision',
          target,
          expectedVersion,
          instruction: 'omit',
          description: `Dismiss the open decision without answering it: ${decision.promptMd}`,
        },
      )
    }

    const currentNode = nodeAt(graph.dag, task.status)
    if (currentNode?.kind === 'gate') {
      const target = { taskId: task.id, graphId: graph.id, gate: currentNode.key }
      actionOptions.push({
        kind: 'approve_gate',
        target,
        expectedVersion: expectedTask,
        instruction: 'omit',
        description: `Approve gate ${currentNode.key} and continue to ${currentNode.approve}.`,
      })
      if (currentNode.redirect) {
        actionOptions.push({
          kind: 'redirect_gate',
          target,
          expectedVersion: expectedTask,
          instruction: 'optional',
          description: `Redirect gate ${currentNode.key} to ${currentNode.redirect.target}.`,
        })
      }
      for (const nodeKey of currentNode.rework ?? []) {
        actionOptions.push({
          kind: 'rework_gate',
          target: { ...target, nodeKey },
          expectedVersion: expectedTask,
          instruction: 'optional',
          description: `Send gate ${currentNode.key} back to ${nodeKey} for rework.`,
        })
      }
    }

    for (const node of graph.dag.nodes) {
      if (node.kind !== 'stage') continue
      actionOptions.push({
        kind: 'instruct_next_run',
        target: { taskId: task.id, graphId: graph.id, nodeKey: node.key },
        expectedVersion: expectedTask,
        instruction: 'required',
        description: `Attach guidance to the next run of stage ${node.key}.`,
      })
    }

    const [interruptedStage] = interruptedStages
    if (interruptedStage) {
      actionOptions.push({
        kind: 'restart_stage',
        target: {
          taskId: task.id,
          graphId: graph.id,
          nodeKey: interruptedStage.nodeKey,
          stageId: interruptedStage.id,
        },
        expectedVersion: {
          ...expectedTask,
          stageId: interruptedStage.id,
          attempt: interruptedStage.attempt,
        },
        instruction: 'optional',
        description: `Restart interrupted stage ${interruptedStage.nodeKey}, attempt ${interruptedStage.attempt}.`,
      })
    }

    return actionOptions
  }

  private async completeConversationResponse(
    context: ConversationRunContext,
    execution: ConversationExecution,
    telemetry: ExecutionUsage,
    contextCommit: string | null,
    contextTaskState: TaskState,
  ): Promise<void> {
    const { response, task } = context
    await this.deps.db.transaction(async (tx) => {
      const [completed] = await tx
        .update(conversationMessages)
        .set({
          status: 'completed',
          contentMd: execution.message ?? '',
          telemetry: [...response.telemetry, telemetry],
          contextCommit,
          taskState: contextTaskState,
          failureReason: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(conversationMessages.id, response.id),
            eq(conversationMessages.status, 'responding'),
          ),
        )
        .returning()
      if (!completed) return

      for (const proposal of execution.actions ?? []) {
        const [action] = await tx
          .insert(conversationActions)
          .values({
            taskId: task.id,
            conversationId: response.conversationId,
            messageId: response.id,
            kind: proposal.kind,
            target: proposal.target,
            instruction: proposal.instruction,
            expectedVersion:
              proposal.expectedVersion as ConversationActionProposal['expectedVersion'] & {
                taskStatus: TaskState
              },
          })
          .returning({ id: conversationActions.id })
        if (action) {
          await emitEvent(tx, {
            taskId: task.id,
            type: 'conversation.action.proposed',
            payload: {
              conversationId: response.conversationId,
              messageId: response.id,
              actionId: action.id,
              kind: proposal.kind,
            },
          })
        }
      }
      await tx
        .update(conversations)
        .set({
          contextCommit,
          contextTaskState,
          providerSession: execution.providerSession ?? null,
          updatedAt: new Date(),
        })
        .where(eq(conversations.id, response.conversationId))
      await emitEvent(tx, {
        taskId: task.id,
        type: 'conversation.response.completed',
        payload: {
          conversationId: response.conversationId,
          messageId: response.id,
          sequence: response.sequence,
          contextCommit,
          taskState: contextTaskState,
        },
      })
    })
  }

  private async runStage(
    task: Task,
    graph: RunGraphRow,
    node: StageNode,
    row: Stage,
    dispatcher: StageDispatcher,
  ): Promise<void> {
    const { db, workspaces, log } = this.deps

    let workspace: Workspace | undefined
    let execution: StageExecution
    try {
      await emitEvent(db, {
        taskId: task.id,
        stageId: row.id,
        type: 'stage.dispatched',
        payload: { node: node.key, role: node.role, provider: row.provider, attempt: row.attempt },
      })
      workspace = await workspaces.provision({
        taskId: task.id,
        slug: task.slug,
        repoUrl: task.repoUrl,
        baseBranch: task.baseBranch,
      })
      if (workspaces.headCommit) {
        const workspaceCommit = await workspaces.headCommit(workspace)
        const stamped = await db
          .update(stages)
          .set({ workspaceCommit, updatedAt: new Date() })
          .where(and(eq(stages.id, row.id), eq(stages.status, 'running')))
          .returning({ id: stages.id })

        // A concurrent stopStage() already moved this attempt to 'interrupted'
        // between claim() and here; cleanupInterruptedAttempt owns it now, and
        // dispatching would run the agent over a workspace mid-discard.
        if (stamped.length === 0) {
          log?.(
            `stage ${task.id}/${node.key} attempt ${row.attempt} was interrupted before dispatch`,
          )

          return
        }
        row = { ...row, workspaceCommit }
      }
      if (workspaces.writeDecisionLog) await this.writeDecisionLog(task.id, workspace)
      execution = await dispatcher({
        task,
        graphId: graph.id,
        dag: graph.dag,
        node,
        stageId: row.id,
        attempt: row.attempt,
        provider: row.provider,
        workspace,
      })
    } catch (e) {
      await this.failAttempt(task, graph, node, row, 'crash', (e as Error).message, workspace, null)

      return
    }

    const defect = stageDefect(node, execution)
    if (defect) {
      await this.failAttempt(
        task,
        graph,
        node,
        row,
        defect.reason,
        defect.detail,
        workspace,
        execution.telemetry,
      )

      return
    }

    // Past this point the stage itself succeeded. Bookkeeping trouble must not
    // rewrite that outcome into a failed attempt: the records already written
    // are enough for the next tick or the startup sweep to continue from.
    try {
      await this.completeStage(task, graph, node, row, execution, workspace)
    } catch (e) {
      log?.(
        `bookkeeping after ${task.id}/${node.key} attempt ${row.attempt}: ${(e as Error).message}`,
      )
    }
  }

  /**
   * Regenerates `decisions.md` from the store into the change folder, right
   * before the run that will read it: the one moment the content matters, in
   * the one process that owns the tree. Rides the stage's own commit, so an
   * agent's edits to the file never survive past this point, and a
   * re-provisioned workspace reproduces it the same way.
   */
  private async writeDecisionLog(taskId: string, workspace: Workspace): Promise<void> {
    if (!this.deps.workspaces.writeDecisionLog) return

    const rows = await this.deps.db
      .select()
      .from(decisions)
      .where(eq(decisions.taskId, taskId))
      .orderBy(asc(decisions.createdAt))
    await this.deps.workspaces.writeDecisionLog(workspace, renderDecisionLog(rows))
  }

  private async completeStage(
    task: Task,
    graph: RunGraphRow,
    node: StageNode,
    row: Stage,
    execution: StageExecution,
    workspace: Workspace | undefined,
  ): Promise<void> {
    const result = execution.result
    if (!result) throw new Error(`stage ${row.id} succeeded without a result`)

    const accepted = await this.withTaskLock(task.id, async (tx) => {
      const [liveStage] = await tx
        .select({ id: stages.id })
        .from(stages)
        .where(and(eq(stages.id, row.id), eq(stages.status, 'running')))
        .limit(1)
      if (!liveStage) {
        if (execution.telemetry) {
          await tx
            .update(stages)
            .set({ cost: usageRecord(execution.telemetry), updatedAt: new Date() })
            .where(and(eq(stages.id, row.id), eq(stages.status, 'interrupted')))
        }

        return null
      }

      const { task: liveTask, graph: liveGraph } = await this.taskWithGraph(task.id, tx)
      if (liveGraph.id !== graph.id || liveTask.status !== node.key) return null

      let acceptedCommit = execution.commit ?? null
      if (execution.commitDeferred) {
        if (!workspace || !this.deps.workspaces.commitStage) {
          throw new Error(`stage ${row.id} deferred its commit without an accepting workspace`)
        }
        const commit = await this.deps.workspaces.commitStage(task.id, workspace, {
          stageId: row.id,
          role: node.role,
          provider: row.provider,
          attempt: row.attempt,
        })
        acceptedCommit = commit.committed ? commit.commit : null
      }

      const reworkedAt = await lastReworkAt(tx, task.id)
      const rounds = await roundsFor(tx, task.id, reworkedAt)
      const decision = advance(
        liveGraph.dag,
        node.key,
        {
          status: result.status === 'needs_decision' ? 'needs_decision' : 'ok',
          verdict: result.verdict,
          findings: result.findings,
          hasBlockingDecision: result.decisions_needed.some((request) => request.blocking),
        },
        rounds,
        liveTask.caps,
      )

      // A stage that asked a blocking question, escalated, or spent a loop's
      // cap did work and committed it, but did not finish its node: recording
      // it as `succeeded` would say otherwise, and would not distinguish "the
      // node is done" from "the node is stuck" for the next tick or a human.
      const completed = await tx
        .update(stages)
        .set({
          status: decision.kind === 'park' ? 'waiting_human' : 'succeeded',
          finishedAt: new Date(),
          cost: usageRecord(execution.telemetry),
          result,
          acceptedCommit,
          updatedAt: new Date(),
        })
        .where(and(eq(stages.id, row.id), eq(stages.status, 'running')))
        .returning({ id: stages.id })
      if (completed.length === 0) return null

      await emitEvent(tx, {
        taskId: task.id,
        stageId: row.id,
        type: 'stage.completed',
        payload: {
          node: node.key,
          attempt: row.attempt,
          verdict: result.verdict ?? null,
          commit: acceptedCommit,
        },
      })

      if (decision.record) await recordRound(tx, task.id, decision.record)

      // Every decision requested this run becomes a durable record, whatever
      // the outcome — a non-blocking one is recorded without parking anything.
      for (const request of result.decisions_needed) {
        await raiseDecision(tx, task.id, row.id, decisionFromRequest(node.key, request))
      }

      if (decision.kind === 'park') {
        // A park no agent asked for gets the engine's own escalation, so the
        // invariant "parked implies an open decision" holds for every cause.
        if (decision.reason !== 'needs_decision') {
          for (const input of escalationEvidence(
            decision.reason,
            node,
            decision.record,
            rounds,
            liveTask.caps,
          )) {
            await raiseDecision(tx, task.id, row.id, escalationForPark(input))
          }
        }

        await this.applyTransition(tx, liveTask, liveGraph.dag, 'waiting_human', {
          cause: decision.reason,
          resume: decision.resume,
          stageId: row.id,
        })

        return { task: liveTask, graph: liveGraph, to: 'waiting_human' as TaskState }
      }

      await this.applyTransition(tx, liveTask, liveGraph.dag, decision.to, {
        cause: decision.kind === 'loop' ? 'revise' : 'advance',
        stageId: row.id,
      })

      return { task: liveTask, graph: liveGraph, to: decision.to }
    })
    if (accepted) await this.releaseIfTerminal(accepted.task, accepted.graph.dag, accepted.to)
  }

  /**
   * One dispatch is one attempt, whatever the runner retried internally.
   * While attempts remain the workspace is discarded and the next tick
   * re-dispatches; a spent cap fails the task naming the stage — never silently.
   *
   * The stage-failed record, the cap check, and (if the cap is spent) the
   * task's own move to `failed` — including dismissing its open decisions —
   * are one atomic step: a crash between them must never leave the task
   * failed with decisions still open, or failed with no `stage.failed` event
   * to explain it.
   */
  private async failAttempt(
    task: Task,
    graph: RunGraphRow,
    node: StageNode,
    row: Stage,
    reason: string,
    detail: string | undefined,
    workspace: Workspace | undefined,
    telemetry: StageTelemetry | null | undefined,
  ): Promise<void> {
    const { workspaces, log } = this.deps

    const outcome = await this.withTaskLock(task.id, async (tx) => {
      const failed = await tx
        .update(stages)
        .set({
          status: 'failed',
          finishedAt: new Date(),
          cost: { ...usageRecord(telemetry), failure: { reason, detail } },
          updatedAt: new Date(),
        })
        .where(and(eq(stages.id, row.id), eq(stages.status, 'running')))
        .returning({ id: stages.id })
      if (failed.length === 0) {
        if (telemetry) {
          await tx
            .update(stages)
            .set({ cost: usageRecord(telemetry), updatedAt: new Date() })
            .where(and(eq(stages.id, row.id), eq(stages.status, 'interrupted')))
        }

        return 'interrupted' as const
      }
      await emitEvent(tx, {
        taskId: task.id,
        stageId: row.id,
        type: 'stage.failed',
        payload: { node: node.key, attempt: row.attempt, reason, detail: detail ?? null },
      })

      if (await this.capSpent(tx, task.id, graph.id, node.key)) {
        await this.applyTransition(tx, task, graph.dag, 'failed', {
          cause: reason,
          resume: node.key,
          stageId: row.id,
          payload: { stage: node.key, reason, detail: detail ?? null },
        })

        return 'exhausted' as const
      }

      return 'retry' as const
    })

    if (outcome === 'exhausted') {
      await this.failTerminalQueuedResponses(task.id)

      return
    }
    if (outcome === 'interrupted') return

    // Only while attempts remain: a task out of attempts leaves its tree as
    // evidence, which is what the human will be asked to look at.
    if (workspace) {
      await workspaces.discard(workspace, row.workspaceCommit ?? undefined).catch((e: Error) => {
        log?.(`discard after failed attempt on ${task.id}/${node.key}: ${e.message}`)
      })
    }
  }

  /**
   * The cap counts consecutive trailing failures of this node: a loop edge
   * revisiting the node starts a fresh streak at its success, and a human
   * restart starts one at its watermark — so neither prior rounds nor a
   * pre-restart failure eat the fresh attempt budget a restart is meant to
   * grant. Bounded to the cap itself: once that many trailing rows are seen,
   * the streak either already meets it or has broken, so nothing past that
   * row can change the answer.
   */
  private async attemptHistory(
    db: DbClient,
    taskId: string,
    graphId: string,
    nodeKey: string,
  ): Promise<{ streak: number; lastAttempt: number }> {
    const restartedAt = await lastRestartAt(db, taskId)
    const rows = await db
      .select({ status: stages.status, startedAt: stages.startedAt, attempt: stages.attempt })
      .from(stages)
      .where(and(eq(stages.graphId, graphId), eq(stages.nodeKey, nodeKey)))
      .orderBy(desc(stages.attempt))
      .limit(this.deps.settings.stageAttemptCap)

    let streak = 0
    for (const row of rows) {
      // No timestamp is not evidence of "before the restart" — treat it like
      // one to be safe, since undercounting the streak is the safe direction.
      if (restartedAt && (!row.startedAt || row.startedAt <= restartedAt)) break
      if (row.status !== 'failed') break

      streak += 1
    }

    return { streak, lastAttempt: rows[0]?.attempt ?? -1 }
  }

  private async capSpent(
    db: DbClient,
    taskId: string,
    graphId: string,
    nodeKey: string,
  ): Promise<boolean> {
    const { streak } = await this.attemptHistory(db, taskId, graphId, nodeKey)

    return streak >= this.deps.settings.stageAttemptCap
  }

  /**
   * Startup sweep: a stage or conversation response recorded running with no orchestrator behind
   * it is a failed attempt. Kill whatever its labels still name, update the
   * record in place, and let the next tick re-dispatch under the same cap.
   * Tasks without an orphaned execution are untouched.
   */
  async sweep(): Promise<number> {
    const { db, log } = this.deps
    const [orphans, orphanedResponses] = await Promise.all([
      db
        .select({ stage: stages, task: tasks })
        .from(stages)
        .innerJoin(tasks, eq(stages.taskId, tasks.id))
        .where(eq(stages.status, 'running')),
      db
        .select({ response: conversationMessages, task: tasks })
        .from(conversationMessages)
        .innerJoin(conversations, eq(conversationMessages.conversationId, conversations.id))
        .innerJoin(tasks, eq(conversations.taskId, tasks.id))
        .where(eq(conversationMessages.status, 'responding')),
    ])

    // Each orphan belongs to a different task, so settling them has nothing to
    // serialize on; running them concurrently keeps /readyz from waiting on
    // N sequential kill-and-discard round trips after a crash.
    const settled = await Promise.allSettled(
      orphans.map(({ stage: row, task }) => this.settleOrphan(task, row)),
    )
    for (const [i, outcome] of settled.entries()) {
      if (outcome.status !== 'rejected') continue

      const orphan = orphans[i]
      if (!orphan) continue

      log?.(
        `sweep: settling ${orphan.task.id}/${orphan.stage.nodeKey} failed: ${(outcome.reason as Error).message}`,
      )
    }

    for (const { response, task } of orphanedResponses) {
      try {
        await this.settleOrphanResponse(task, response)
      } catch (error) {
        log?.(`sweep: settling response ${response.id} failed: ${(error as Error).message}`)
      }
    }

    const recoveredInterruptions = await this.recoverPendingInterruptions()
    const recoveredActions = await this.recoverStuckActions()
    await this.reportUnexplainedParks()

    return orphans.length + orphanedResponses.length + recoveredInterruptions + recoveredActions
  }

  /**
   * REQ-1201's invariant, checked rather than repaired: a `waiting_human` task
   * with no open decision is a bug — the park transition and its decision
   * insert are meant to commit together — and the honest response is to log
   * it for a human, not to silently mint a decision or guess a resume.
   */
  private async reportUnexplainedParks(): Promise<void> {
    const rows = await this.deps.db
      .select({ id: tasks.id })
      .from(tasks)
      .leftJoin(
        decisions,
        and(
          eq(decisions.taskId, tasks.id),
          eq(decisions.status, 'open'),
          eq(decisions.blocking, true),
        ),
      )
      .where(and(eq(tasks.status, 'waiting_human'), sql`${decisions.id} is null`))

    for (const row of rows) {
      this.deps.log?.(
        `sweep: task ${row.id} is waiting_human with no open blocking decision — this is a defect, not repaired`,
      )
    }
  }

  /**
   * Retries both a freshly-interrupted stage (`pending`) and one whose last
   * cleanup attempt errored (`failed`, past the backoff window) — otherwise a
   * transient docker/git error strands the task in 'paused' forever, since
   * nothing else ever revisits a 'failed' cleanup.
   */
  private async recoverPendingInterruptions(): Promise<number> {
    if (!this.deps.killOrphans) return 0

    const retryCutoff = new Date(Date.now() - INTERRUPTION_CLEANUP_RETRY_MS)
    const pending = await this.deps.db
      .select({ stage: stages, task: tasks })
      .from(stages)
      .innerJoin(tasks, eq(stages.taskId, tasks.id))
      .where(
        and(
          eq(stages.status, 'interrupted'),
          or(
            eq(stages.interruptionCleanupStatus, 'pending'),
            and(eq(stages.interruptionCleanupStatus, 'failed'), lt(stages.updatedAt, retryCutoff)),
          ),
        ),
      )

    for (const { task, stage } of pending) {
      await this.cleanupInterruptedAttempt(task, stage).catch((error: Error) => {
        this.deps.log?.(`interruption cleanup for ${stage.id} failed: ${error.message}`)
      })
    }

    return pending.length
  }

  /**
   * An action can only be seen mid-'applying' by a later tick if the process
   * that set it crashed before recording an outcome — confirmAction itself
   * runs the whole apply-and-record sequence in one call. Past the timeout,
   * treat it like any other failed confirmation: visible and retryable by a
   * fresh confirmAction call, rather than silently stuck forever.
   */
  private async recoverStuckActions(): Promise<number> {
    const stuckCutoff = new Date(Date.now() - STUCK_ACTION_TIMEOUT_MS)
    const stuck = await this.deps.db
      .update(conversationActions)
      .set({
        status: 'conflict',
        outcome: { detail: 'action was left applying after an orchestrator restart' },
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(conversationActions.status, 'applying'),
          lt(conversationActions.updatedAt, stuckCutoff),
        ),
      )
      .returning({ id: conversationActions.id })

    for (const row of stuck) {
      this.deps.log?.(`action ${row.id} was stuck in applying; marked conflict for retry`)
    }

    return stuck.length
  }

  private async settleOrphan(task: Task, row: Stage): Promise<void> {
    const { workspaces, killOrphans, log } = this.deps
    log?.(
      `sweep: task ${task.id} node ${row.nodeKey} attempt ${row.attempt} was recorded running with no live execution`,
    )
    const killed =
      (await killOrphans?.({
        'specmate.task': task.id,
        'specmate.node': row.nodeKey,
      }).catch(() => [])) ?? []
    for (const id of killed) log?.(`sweep: killed ${id}`)

    // The stage-failed record, the cap check, and the task's own move to
    // `failed` are one atomic step — see failAttempt's identical concern.
    const outcome = await this.withTaskLock(task.id, async (tx) => {
      await tx
        .update(stages)
        .set({
          status: 'failed',
          finishedAt: new Date(),
          cost: { ...(row.cost ?? {}), failure: { reason: 'orphaned' } },
          updatedAt: new Date(),
        })
        .where(eq(stages.id, row.id))
      await emitEvent(tx, {
        taskId: task.id,
        stageId: row.id,
        type: 'stage.failed',
        payload: { node: row.nodeKey, attempt: row.attempt, reason: 'orphaned' },
      })

      // The cap is judged against the orphaned row's own graph and node — the
      // latest graph and task.status may have diverged from it (a replan).
      if (!(await this.capSpent(tx, task.id, row.graphId, row.nodeKey))) return 'retry' as const

      const graph = await latestGraph(tx, task.id)
      if (graph && canTransition(graph.dag, task.status, 'failed')) {
        await this.applyTransition(tx, task, graph.dag, 'failed', {
          cause: 'orphaned',
          resume: row.nodeKey as TaskState,
          stageId: row.id,
          payload: { stage: row.nodeKey, reason: 'orphaned' },
        })

        return 'exhausted' as const
      }

      return 'exhausted-no-transition' as const
    })

    if (outcome === 'exhausted') await this.failTerminalQueuedResponses(task.id)
    // Out of attempts: the tree stays exactly as the dead attempt left it —
    // the evidence a human will be asked to look at, as in failAttempt.
    if (outcome !== 'retry') return

    // Attempts remain: reset the tree so the retry starts from committed state.
    try {
      const workspace = await workspaces.provision({
        taskId: task.id,
        slug: task.slug,
        repoUrl: task.repoUrl,
        baseBranch: task.baseBranch,
      })
      await workspaces.discard(workspace, row.workspaceCommit ?? undefined)
    } catch (e) {
      log?.(`sweep: workspace discard for ${task.id} failed: ${(e as Error).message}`)
    }
  }

  private async settleOrphanResponse(task: Task, response: ConversationMessage): Promise<void> {
    const { killOrphans, log, workspaces } = this.deps
    const attempt = response.telemetry.length
    log?.(`sweep: conversation response ${response.id} attempt ${attempt} had no live execution`)
    const killed =
      (await killOrphans?.({
        'specmate.task': task.id,
        'specmate.node': 'conversation',
        'specmate.attempt': String(attempt),
      }).catch(() => [])) ?? []
    for (const id of killed) log?.(`sweep: killed ${id}`)

    // Mirrors failTerminalQueuedResponses: a response is only finalized once
    // its workspace is actually gone, so a failed cleanup leaves the row for
    // the next sweep to retry instead of leaking the worktree permanently.
    let cleaned = true
    try {
      await workspaces.releaseConversation(task, `${response.id}-${attempt}`)
    } catch (error) {
      cleaned = false
      log?.(
        `sweep: response workspace cleanup for ${response.id} failed: ${(error as Error).message}`,
      )
    }
    if (!cleaned) return

    const finishedAt = new Date()
    const telemetry: ExecutionUsage = {
      provider: this.resolveAnswerProvider(),
      model: null,
      startedAt: null,
      finishedAt: finishedAt.toISOString(),
      durationMs: null,
      tokens: null,
      costUsd: null,
      raw: null,
      failure: { reason: 'orphaned' },
    }
    const attempts = [...response.telemetry, telemetry]
    const terminal = isTerminal(task.status)
    if (terminal || attempts.length >= CONVERSATION_ATTEMPT_CAP) {
      const reason = terminal ? `task became ${task.status}` : 'orphaned'
      await this.deps.db.transaction(async (tx) => {
        await tx
          .update(conversationMessages)
          .set({
            status: 'failed',
            failureReason: reason,
            telemetry: attempts,
            updatedAt: finishedAt,
          })
          .where(eq(conversationMessages.id, response.id))
        await emitEvent(tx, {
          taskId: task.id,
          type: 'conversation.response.failed',
          payload: {
            conversationId: response.conversationId,
            messageId: response.id,
            reason,
          },
        })
      })

      return
    }

    await this.deps.db
      .update(conversationMessages)
      .set({ status: 'queued', telemetry: attempts, updatedAt: finishedAt })
      .where(eq(conversationMessages.id, response.id))
  }

  async stopStage(options: StopStageOptions): Promise<{ stage: Stage; task: Task }> {
    const claimed = await this.withTaskLock(options.taskId, async (tx) => {
      const [task] = await tx.select().from(tasks).where(eq(tasks.id, options.taskId)).limit(1)
      if (!task) throw new TaskNotFoundError(options.taskId)

      const [stage] = await tx
        .update(stages)
        .set({
          status: 'interrupted',
          finishedAt: new Date(),
          interruptedBy: options.actor,
          interruptionCleanupStatus: 'pending',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(stages.id, options.stageId),
            eq(stages.taskId, options.taskId),
            eq(stages.graphId, options.graphId),
            eq(stages.nodeKey, options.nodeKey),
            eq(stages.attempt, options.attempt),
            eq(stages.status, 'running'),
          ),
        )
        .returning()
      if (!stage || task.status !== options.nodeKey)
        throw new StageStopConflictError(options.stageId)
      const graph = await latestGraph(tx, task.id)
      if (!graph || graph.id !== options.graphId) throw new StageStopConflictError(options.stageId)

      await emitEvent(tx, {
        taskId: task.id,
        stageId: stage.id,
        type: 'stage.stopping',
        payload: { node: stage.nodeKey, attempt: stage.attempt, actor: options.actor },
      })
      await this.applyTransition(tx, task, graph.dag, 'paused', {
        cause: 'owner_interrupted',
        actor: options.actor,
        resume: stage.nodeKey as TaskState,
        stageId: stage.id,
      })

      return { task, stage }
    })

    // API processes can claim the stop without owning the execution. The live
    // orchestrator sees the durable pending row on its next tick and performs
    // the exact-label kill and cleanup; startup sweep repeats the same work.
    const stage = this.deps.killOrphans
      ? await this.cleanupInterruptedAttempt(claimed.task, claimed.stage)
      : claimed.stage
    const [currentTask] = await this.deps.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, claimed.task.id))
      .limit(1)

    return { stage, task: currentTask ?? claimed.task }
  }

  private async cleanupInterruptedAttempt(task: Task, stage: Stage): Promise<Stage> {
    try {
      await this.deps.killOrphans?.({
        'specmate.task': task.id,
        'specmate.node': stage.nodeKey,
        'specmate.attempt': String(stage.attempt),
      })
      await this.stageRuns.get(stage.id)
      const workspace = await this.deps.workspaces.provision({
        taskId: task.id,
        slug: task.slug,
        repoUrl: task.repoUrl,
        baseBranch: task.baseBranch,
      })
      await this.deps.workspaces.discard(workspace, stage.workspaceCommit ?? undefined)
      const [cleaned] = await this.deps.db
        .update(stages)
        .set({
          interruptionCleanupStatus: 'succeeded',
          interruptionFailure: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(stages.id, stage.id),
            eq(stages.status, 'interrupted'),
            eq(stages.interruptionCleanupStatus, 'pending'),
          ),
        )
        .returning()
      if (!cleaned) {
        const [current] = await this.deps.db
          .select()
          .from(stages)
          .where(eq(stages.id, stage.id))
          .limit(1)

        return current ?? stage
      }
      await emitEvent(this.deps.db, {
        taskId: task.id,
        stageId: stage.id,
        type: 'stage.interrupted',
        payload: { node: stage.nodeKey, attempt: stage.attempt },
      })

      return cleaned
    } catch (error) {
      const detail = (error as Error).message
      await this.deps.db
        .update(stages)
        .set({
          interruptionCleanupStatus: 'failed',
          interruptionFailure: detail,
          updatedAt: new Date(),
        })
        .where(and(eq(stages.id, stage.id), eq(stages.interruptionCleanupStatus, 'pending')))
      await emitEvent(this.deps.db, {
        taskId: task.id,
        stageId: stage.id,
        type: 'stage.cleanup_failed',
        payload: { node: stage.nodeKey, attempt: stage.attempt, detail },
      })
      throw new StopCleanupError(stage.id, detail)
    }
  }

  async restartInterruptedStage(options: RestartInterruptedStageOptions): Promise<Task> {
    return this.withTaskLock(options.taskId, async (tx) => {
      const [existing] = await tx
        .select({ id: feedback.id })
        .from(feedback)
        .where(
          and(
            eq(feedback.taskId, options.taskId),
            eq(feedback.idempotencyKey, options.idempotencyKey),
          ),
        )
        .limit(1)
      const { task, graph } = await this.taskWithGraph(options.taskId, tx)
      if (existing) return task

      const [stage] = await tx
        .select()
        .from(stages)
        .where(and(eq(stages.id, options.stageId), eq(stages.taskId, task.id)))
        .limit(1)
      if (
        task.status !== 'paused' ||
        !stage ||
        stage.status !== 'interrupted' ||
        stage.interruptionCleanupStatus !== 'succeeded' ||
        task.resumeStatus !== stage.nodeKey
      ) {
        throw new StageRestartConflictError(options.stageId)
      }

      const instruction = options.guidance?.trim() ?? ''
      await tx.insert(feedback).values({
        taskId: task.id,
        stageId: stage.id,
        kind: 'intervention',
        textMd: instruction,
        target: {
          graphId: stage.graphId,
          nodeKey: stage.nodeKey,
          stageId: stage.id,
          attempt: stage.attempt,
        },
        idempotencyKey: options.idempotencyKey,
      })
      if (options.actionId) {
        await tx
          .update(conversationActions)
          .set({ status: 'applied', actor: options.actor, updatedAt: new Date() })
          .where(eq(conversationActions.id, options.actionId))
      }
      await emitEvent(tx, {
        taskId: task.id,
        stageId: stage.id,
        type: 'stage.restart_confirmed',
        payload: {
          node: stage.nodeKey,
          attempt: stage.attempt,
          instruction,
          actor: options.actor,
          actionId: options.actionId ?? null,
        },
      })
      await this.applyTransition(tx, task, graph.dag, stage.nodeKey as TaskState, {
        cause: 'restart_interrupted',
        actor: options.actor,
        stageId: stage.id,
      })
      const [updated] = await tx.select().from(tasks).where(eq(tasks.id, task.id)).limit(1)

      return updated ?? { ...task, status: stage.nodeKey as TaskState, resumeStatus: null }
    })
  }

  async confirmAction(options: ConfirmActionOptions): Promise<void> {
    const confirmation = await this.withTaskLock(options.taskId, async (tx) => {
      const [action] = await tx
        .select()
        .from(conversationActions)
        .where(
          and(
            eq(conversationActions.id, options.actionId),
            eq(conversationActions.taskId, options.taskId),
          ),
        )
        .limit(1)
      if (!action) throw new ActionConflictError(options.actionId, 'action does not exist')

      if (action.status === 'applied') return { action, conflictReason: null, shouldApply: false }

      if (action.status === 'applying' && action.idempotencyKey === options.idempotencyKey) {
        return { action, conflictReason: null, shouldApply: false }
      }
      if (action.status !== 'proposed' && action.status !== 'confirmed') {
        throw new ActionConflictError(action.id, `action is ${action.status}`)
      }
      const [task] = await tx.select().from(tasks).where(eq(tasks.id, options.taskId)).limit(1)
      if (!task) throw new TaskNotFoundError(options.taskId)

      const versionConflict = await this.actionVersionConflict(tx, task, action)
      if (versionConflict) {
        await tx
          .update(conversationActions)
          .set({
            status: 'conflict',
            actor: options.actor,
            outcome: versionConflict.outcome,
            idempotencyKey: options.idempotencyKey,
            updatedAt: new Date(),
          })
          .where(eq(conversationActions.id, action.id))
        return {
          action: { ...action, status: 'conflict' as const },
          conflictReason: versionConflict.reason,
          shouldApply: false,
        }
      }
      const [confirmed] = await tx
        .update(conversationActions)
        .set({
          status: 'applying',
          actor: options.actor,
          idempotencyKey: options.idempotencyKey,
          updatedAt: new Date(),
        })
        .where(eq(conversationActions.id, action.id))
        .returning()
      await emitEvent(tx, {
        taskId: task.id,
        type: 'conversation.action.confirmed',
        payload: { actionId: action.id, kind: action.kind, actor: options.actor },
      })

      return { action: confirmed ?? action, conflictReason: null, shouldApply: true }
    })
    const { action, conflictReason, shouldApply } = confirmation
    if (conflictReason) throw new ActionConflictError(action.id, conflictReason)

    if (!shouldApply) return

    try {
      switch (action.kind) {
        case 'approve_gate':
          await this.approve(options.taskId, options.actor)
          break
        case 'redirect_gate':
          await this.redirect(options.taskId, options.actor, action.instruction ?? undefined)
          break
        case 'rework_gate': {
          const target = action.target.nodeKey as TaskState | undefined
          if (!target) throw new ActionConflictError(action.id, 'rework target is missing')

          await this.rework({
            taskId: options.taskId,
            actor: options.actor,
            target,
            comment: action.instruction ?? undefined,
          })
          break
        }
        case 'restart_stage': {
          const stageId = action.target.stageId
          if (!stageId)
            throw new ActionConflictError(action.id, 'interrupted stage target is missing')
          await this.restartInterruptedStage({
            taskId: options.taskId,
            stageId,
            actor: options.actor,
            guidance: action.instruction ?? undefined,
            idempotencyKey: options.idempotencyKey,
            actionId: action.id,
          })
          break
        }
        case 'answer_decision': {
          const decisionId = action.target.decisionId
          if (!decisionId) throw new ActionConflictError(action.id, 'decision target is missing')

          await this.answer({
            taskId: options.taskId,
            decisionId,
            actor: options.actor,
            text: action.instruction ?? undefined,
          })
          break
        }
        case 'dismiss_decision': {
          const decisionId = action.target.decisionId
          if (!decisionId) throw new ActionConflictError(action.id, 'decision target is missing')

          await this.dismiss({
            taskId: options.taskId,
            decisionId,
            actor: options.actor,
            reason: action.instruction ?? undefined,
          })
          break
        }
        case 'instruct_next_run': {
          const target = action.target.nodeKey
          if (!target) throw new ActionConflictError(action.id, 'future-run target is missing')

          await this.deps.db.insert(feedback).values({
            taskId: options.taskId,
            kind: 'intervention',
            textMd: action.instruction ?? '',
            target: { ...action.target, actionId: action.id },
            idempotencyKey: options.idempotencyKey,
          })
          break
        }
      }
      await this.deps.db.transaction(async (tx) => {
        await tx
          .update(conversationActions)
          .set({ status: 'applied', outcome: { ok: true }, updatedAt: new Date() })
          .where(eq(conversationActions.id, action.id))
        await emitEvent(tx, {
          taskId: options.taskId,
          type: 'conversation.action.applied',
          payload: { actionId: action.id, kind: action.kind },
        })
      })
    } catch (error) {
      await this.deps.db
        .update(conversationActions)
        .set({
          status: 'conflict',
          outcome: { detail: (error as Error).message },
          updatedAt: new Date(),
        })
        .where(eq(conversationActions.id, action.id))
      throw error
    }
  }

  private async actionVersionConflict(
    tx: DbClient,
    task: Task,
    action: ConversationAction,
  ): Promise<{ reason: string; outcome: Record<string, unknown> } | null> {
    const expected = action.expectedVersion
    // A decision-targeted action (answer/dismiss) is scoped by the decision's
    // own status below, not the task's — a non-blocking decision leaves the
    // task free to keep advancing while it stays open, so pinning taskStatus
    // here would conflict a still-valid answer out from under the owner.
    if (!action.target.decisionId && task.status !== expected.taskStatus) {
      return {
        reason: `expected task ${expected.taskStatus}, got ${task.status}`,
        outcome: { field: 'taskStatus', expected: expected.taskStatus, actual: task.status },
      }
    }

    const graph = await latestGraph(tx, task.id)
    if (expected.graphId && graph?.id !== expected.graphId) {
      return {
        reason: `expected graph ${expected.graphId}, got ${graph?.id ?? 'none'}`,
        outcome: { field: 'graphId', expected: expected.graphId, actual: graph?.id ?? null },
      }
    }
    if (action.target.gate && task.status !== action.target.gate) {
      return {
        reason: `expected gate ${action.target.gate}, got ${task.status}`,
        outcome: { field: 'gate', expected: action.target.gate, actual: task.status },
      }
    }

    const expectedStageId = expected.stageId ?? action.target.stageId
    if (expectedStageId) {
      const [stage] = await tx
        .select()
        .from(stages)
        .where(and(eq(stages.id, expectedStageId), eq(stages.taskId, task.id)))
        .limit(1)
      if (!stage) {
        return {
          reason: `expected stage ${expectedStageId} no longer exists`,
          outcome: { field: 'stageId', expected: expectedStageId, actual: null },
        }
      }
      if (expected.attempt !== undefined && stage.attempt !== expected.attempt) {
        return {
          reason: `expected stage attempt ${expected.attempt}, got ${stage.attempt}`,
          outcome: { field: 'attempt', expected: expected.attempt, actual: stage.attempt },
        }
      }
    }

    if (expected.decisionStatus && action.target.decisionId) {
      const [decision] = await tx
        .select({ status: decisions.status })
        .from(decisions)
        .where(and(eq(decisions.id, action.target.decisionId), eq(decisions.taskId, task.id)))
        .limit(1)
      if (decision?.status !== expected.decisionStatus) {
        return {
          reason: `expected decision ${expected.decisionStatus}, got ${decision?.status ?? 'missing'}`,
          outcome: {
            field: 'decisionStatus',
            expected: expected.decisionStatus,
            actual: decision?.status ?? null,
          },
        }
      }
    }

    return null
  }

  // ─── gate operations — the API the Phase-2 UI will call ────────────────────

  async approve(taskId: string, actor: string): Promise<void> {
    const done = await this.withTaskLock(taskId, async (tx) => {
      const { task, graph, gate } = await this.atGate(taskId, tx)
      await emitEvent(tx, {
        taskId,
        type: 'gate.approved',
        payload: { gate: gate.key, to: gate.approve, actor },
      })
      // Dismissed before the transition: a gate whose target is itself a
      // terminal status would otherwise have applyTransition's own terminal
      // dismissal claim every open decision first, under cause 'terminal'
      // rather than 'gate_approved'.
      await this.dismissOpenDecisions(tx, taskId, actor, 'gate_approved')
      await this.applyTransition(tx, task, graph.dag, gate.approve, { cause: 'approve', actor })

      return { task, dag: graph.dag, to: gate.approve }
    })
    await this.releaseIfTerminal(done.task, done.dag, done.to)
  }

  async redirect(taskId: string, actor: string, comment?: string): Promise<void> {
    await this.withTaskLock(taskId, async (tx) => {
      const { task, graph, gate } = await this.atGate(taskId, tx)
      const edge = gate.redirect
      if (!edge) throw new GateEdgeError(gate.key, 'redirect')

      const used = await countRedirects(tx, taskId, gate.key)
      const limit = task.caps[edge.cap]
      if (used >= limit) throw new RedirectCapExhaustedError(gate.key, edge.cap, limit)

      // The lifecycle spec: a redirect's comment is recorded as feedback.
      await tx.insert(feedback).values({
        taskId,
        kind: 'redirect',
        textMd: comment ?? '',
        target: { nodeKey: gate.key },
      })

      await emitEvent(tx, {
        taskId,
        type: 'gate.redirected',
        payload: {
          gate: gate.key,
          to: edge.target,
          round: used + 1,
          actor,
          comment: comment ?? null,
        },
      })
      await this.applyTransition(tx, task, graph.dag, edge.target, { cause: 'redirect', actor })
    })
  }

  /** Re-enters a declared target with fresh round counters (the event is the watermark). */
  async rework({ taskId, actor, target, comment }: ReworkOptions): Promise<void> {
    await this.withTaskLock(taskId, async (tx) => {
      const { task, graph, gate } = await this.atGate(taskId, tx)
      if (!(gate.rework ?? []).includes(target)) throw new ReworkTargetError(gate.key, target)

      // Mirrors redirect's feedback insert: every gate action leaves an audit-trail row.
      // Tagged by the rework target, not the gate, since one gate can declare several targets.
      await tx.insert(feedback).values({
        taskId,
        kind: 'rework',
        textMd: comment ?? '',
        target: { nodeKey: target },
      })

      await emitEvent(tx, {
        taskId,
        type: 'gate.reworked',
        payload: { gate: gate.key, to: target, actor, comment: comment ?? null },
      })
      await this.applyTransition(tx, task, graph.dag, target, { cause: 'rework', actor })
    })
  }

  /**
   * Returns a paused task to the exact state it stopped in. A `waiting_human`
   * task never leaves that state through this operation: REQ-1204 leaves it
   * exactly two exits, resolving its open blocking decisions or cancellation —
   * `answer` and `dismiss` are how the first one moves the task.
   */
  async resume(taskId: string, actor: string): Promise<void> {
    await this.withTaskLock(taskId, async (tx) => {
      const { task, graph } = await this.taskWithGraph(taskId, tx)
      if (task.status !== 'paused') throw new NotParkedError(taskId, task.status)

      const to = task.resumeStatus
      if (!to) throw new NoResumeStateError(taskId)

      await emitEvent(tx, { taskId, type: 'task.resumed', payload: { to, actor } })
      await this.applyTransition(tx, task, graph.dag, to, { cause: 'resume', actor })
    })
  }

  /**
   * Answering is one atomic step: the answer, the answering identity and
   * time, a `decision_answer` feedback record against the asking stage's role
   * and provider, an event, and — when this was the last open blocking
   * decision of a parked task — the task's return to the state it was
   * interrupted in.
   */
  async answer(options: AnswerDecisionOptions): Promise<Task> {
    if (!options.text?.trim() && !options.optionId) {
      throw new DecisionAnswerEmptyError(options.decisionId)
    }

    return this.resolveDecision(options.taskId, options.decisionId, options.actor, 'answered', {
      text: options.text,
      optionId: options.optionId,
    })
  }

  /** Dismissal resolves a decision for the purpose of resuming, recorded distinctly from an answer. */
  async dismiss(options: DismissDecisionOptions): Promise<Task> {
    return this.resolveDecision(options.taskId, options.decisionId, options.actor, 'dismissed', {
      text: options.reason,
    })
  }

  private async resolveDecision(
    taskId: string,
    decisionId: string,
    actor: string,
    status: 'answered' | 'dismissed',
    input: { text?: string; optionId?: string },
  ): Promise<Task> {
    return this.withTaskLock(taskId, async (tx) => {
      const [decision] = await tx
        .select()
        .from(decisions)
        .where(and(eq(decisions.id, decisionId), eq(decisions.taskId, taskId)))
        .limit(1)
      if (!decision) throw new DecisionNotFoundError(decisionId)
      if (decision.status !== 'open') throw new DecisionNotOpenError(decisionId, decision.status)

      const answerMd = resolveAnswerMd(input, decision.options)
      const now = new Date()
      const resolved = await tx
        .update(decisions)
        .set({ status, answerMd, answeredBy: actor, answeredAt: now })
        .where(and(eq(decisions.id, decisionId), eq(decisions.status, 'open')))
        .returning({ id: decisions.id })
      if (resolved.length === 0) throw new DecisionNotOpenError(decisionId, decision.status)

      if (status === 'answered' && decision.stageId) {
        const [stage] = await tx
          .select({ role: stages.role, provider: stages.provider })
          .from(stages)
          .where(eq(stages.id, decision.stageId))
          .limit(1)
        await tx.insert(feedback).values({
          taskId,
          stageId: decision.stageId,
          role: stage?.role,
          provider: stage?.provider,
          kind: 'decision_answer',
          textMd: answerMd ?? '',
          target: { decisionId },
        })
      }

      await emitEvent(tx, {
        taskId,
        stageId: decision.stageId ?? undefined,
        type: status === 'answered' ? 'decision.answered' : 'decision.dismissed',
        payload: { decisionId, nodeKey: decision.nodeKey, key: decision.key, actor },
      })

      const { task, graph } = await this.taskWithGraph(taskId, tx)
      if (task.status !== 'waiting_human') return task

      const openDecisions = await tx
        .select()
        .from(decisions)
        .where(and(eq(decisions.taskId, taskId), eq(decisions.status, 'open')))
      if (blockingOpen(openDecisions)) return task

      const to = task.resumeStatus
      if (!to) throw new NoResumeStateError(taskId)

      await emitEvent(tx, { taskId, type: 'task.resumed', payload: { to, actor } })
      await this.applyTransition(tx, task, graph.dag, to, {
        cause: status === 'answered' ? 'decision_answered' : 'decision_dismissed',
        actor,
      })
      const [resumed] = await tx.select().from(tasks).where(eq(tasks.id, taskId)).limit(1)

      return resumed ?? { ...task, status: to }
    })
  }

  /**
   * Failure is recoverable: re-enter the failed stage, or an earlier one
   * named explicitly. A later stage is refused — it may bind cross_review or
   * otherwise assume artifacts the task never produced on this run.
   */
  async restart(taskId: string, actor: string, to?: TaskState): Promise<void> {
    await this.withTaskLock(taskId, async (tx) => {
      const { task, graph } = await this.taskWithGraph(taskId, tx)
      if (task.status !== 'failed') throw new NotRestartableError(taskId, task.status)

      const failedAt = task.resumeStatus
      if (!failedAt) throw new NoResumeStateError(taskId)

      const target = to ?? failedAt
      if (!isRestartable(graph.dag, target, failedAt)) {
        throw new RestartTargetError(taskId, target, failedAt)
      }

      await emitEvent(tx, { taskId, type: 'task.restarted', payload: { to: target, actor } })
      await this.applyTransition(tx, task, graph.dag, target, { cause: 'restart', actor })
    })
  }

  async cancel(taskId: string, actor: string): Promise<void> {
    const done = await this.withTaskLock(taskId, async (tx) => {
      const { task, graph } = await this.taskWithGraph(taskId, tx)
      await emitEvent(tx, { taskId, type: 'task.cancelled', payload: { actor } })
      await this.applyTransition(tx, task, graph.dag, 'cancelled', { cause: 'cancel', actor })

      return { task, dag: graph.dag }
    })
    await this.releaseIfTerminal(done.task, done.dag, 'cancelled')
  }

  /**
   * Operations that change task state run under the task's advisory lock, in
   * one transaction: they serialize against the claim and against each other,
   * and a failed validation rolls back every event written on the way to it.
   */
  private withTaskLock<T>(taskId: string, fn: (tx: DbClient) => Promise<T>): Promise<T> {
    return this.deps.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${taskId}, 0))`)

      return fn(tx)
    })
  }

  private async atGate(
    taskId: string,
    db: DbClient = this.deps.db,
  ): Promise<{ task: Task; graph: RunGraphRow; gate: GateNode }> {
    const { task, graph } = await this.taskWithGraph(taskId, db)
    const node = nodeAt(graph.dag, task.status)
    if (node?.kind !== 'gate') throw new NotAtGateError(taskId, task.status)

    return { task, graph, gate: node }
  }

  private async taskWithGraph(
    taskId: string,
    db: DbClient = this.deps.db,
  ): Promise<{ task: Task; graph: RunGraphRow }> {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1)
    if (!task) throw new TaskNotFoundError(taskId)

    const graph = await latestGraph(db, taskId)
    if (!graph) throw new Error(`task ${taskId} has no pinned run graph`)

    return { task, graph }
  }

  /**
   * The single door every state change goes through: legality against the
   * pinned graph, the guarded status write, and the event. The write is
   * compare-and-swap on the observed status — the snapshot may be minutes old
   * by the time a stage completes, and a task cancelled meanwhile must stay
   * cancelled rather than be resurrected by its stage's outcome.
   */
  private async applyTransition(
    db: DbClient,
    task: Task,
    dag: PinnedGraph,
    to: TaskState,
    opts: {
      cause: string
      actor?: string
      resume?: TaskState
      stageId?: string
      payload?: Record<string, unknown>
    },
  ): Promise<void> {
    const from = task.status
    if (!canTransition(dag, from, to)) throw new IllegalTransitionError(task.id, from, to)

    const moved = await db
      .update(tasks)
      .set({ status: to, resumeStatus: opts.resume ?? null, updatedAt: new Date() })
      .where(and(eq(tasks.id, task.id), eq(tasks.status, from)))
      .returning({ id: tasks.id })
    if (moved.length === 0) throw new StaleTransitionError(task.id, from, to)

    let type = 'task.transitioned'
    if (to === 'waiting_human') type = 'task.parked'
    if (to === 'failed') type = 'task.failed'

    await emitEvent(db, {
      taskId: task.id,
      stageId: opts.stageId,
      type,
      payload: {
        from,
        to,
        cause: opts.cause,
        ...(opts.actor ? { actor: opts.actor } : {}),
        ...(opts.resume ? { resume: opts.resume } : {}),
        ...(opts.payload ?? {}),
      },
    })

    // A terminal task leaves nothing open behind it: an inbox that
    // accumulates dead questions from finished tasks is an inbox nobody reads.
    if (isTerminal(to))
      await this.dismissOpenDecisions(db, task.id, opts.actor ?? 'system', 'terminal')
  }

  /**
   * REQ-1304: a gate-generic resolution — approving any gate closes what the
   * task still has open. An answered decision is already past `open` and is
   * untouched; only a question never answered is dismissed here, readable in
   * the decision log as declined rather than as never asked.
   */
  private async dismissOpenDecisions(
    db: DbClient,
    taskId: string,
    actor: string,
    cause: 'terminal' | 'gate_approved',
  ): Promise<void> {
    const dismissed = await db
      .update(decisions)
      .set({ status: 'dismissed', answeredBy: actor, answeredAt: new Date() })
      .where(and(eq(decisions.taskId, taskId), eq(decisions.status, 'open')))
      .returning({
        id: decisions.id,
        stageId: decisions.stageId,
        nodeKey: decisions.nodeKey,
        key: decisions.key,
      })

    for (const decision of dismissed) {
      await emitEvent(db, {
        taskId,
        stageId: decision.stageId ?? undefined,
        type: 'decision.dismissed',
        payload: {
          decisionId: decision.id,
          nodeKey: decision.nodeKey,
          key: decision.key,
          actor,
          cause,
        },
      })
    }
  }

  /**
   * Housekeeping belongs to the engine, not to any stage: archive and cancel
   * release the working tree while the mirror keeps the branch. Runs after the
   * transition commits — the release layer re-reads the task and must see the
   * terminal status.
   */
  private async releaseIfTerminal(task: Task, dag: PinnedGraph, to: TaskState): Promise<void> {
    if (to !== dag.terminal && to !== 'cancelled') return

    await this.failTerminalQueuedResponses(task.id)

    await this.deps.workspaces.release(task.id).catch((e: Error) => {
      this.deps.log?.(`workspace release for ${task.id}: ${e.message}`)
    })
  }
}

interface StageDefectRecord {
  readonly reason: string
  readonly detail?: string
}

interface ConversationDefectRecord {
  readonly reason: string
  readonly detail?: string
}

function conversationDefect(execution: ConversationExecution): ConversationDefectRecord | null {
  if (execution.status !== 'succeeded') {
    return { reason: execution.failure ?? 'unknown', detail: execution.detail }
  }
  if (!execution.message?.trim()) {
    return { reason: 'missing_message', detail: 'conversation run returned no message' }
  }

  return null
}

interface ConversationUsageInput {
  readonly provider: ProviderId
  readonly startedAt: Date
  readonly finishedAt: Date
  readonly execution: ConversationExecution
  readonly defect: ConversationDefectRecord | null
  readonly contextPath: 'stored' | 'cached' | 'reconstructed' | 'none'
}

function conversationUsage(input: ConversationUsageInput): ExecutionUsage {
  return {
    provider: input.provider,
    model: input.execution.telemetry?.model ?? null,
    startedAt: input.startedAt.toISOString(),
    finishedAt: input.finishedAt.toISOString(),
    durationMs: input.execution.durationMs,
    tokens: input.execution.telemetry?.tokens ? { ...input.execution.telemetry.tokens } : null,
    costUsd: input.execution.telemetry?.costUsd ?? null,
    raw: input.execution.telemetry?.raw ?? null,
    contextPath: input.contextPath,
    failure: input.defect ? { reason: input.defect.reason, detail: input.defect.detail } : null,
  }
}

/** What, if anything, makes this execution a failed attempt instead of a completion. */
function stageDefect(node: StageNode, execution: StageExecution): StageDefectRecord | null {
  if (execution.status !== 'succeeded') {
    return { reason: execution.failure ?? 'unknown', detail: execution.detail }
  }

  // A dispatcher contract violation, not a bookkeeping failure: caught here it
  // retries or fails the task like any other defect; caught downstream in
  // `completeStage` it would leave the stage stuck at 'running' forever.
  if (!execution.result) {
    return {
      reason: 'missing_result',
      detail: `dispatcher reported success for ${node.key} with no result`,
    }
  }

  // An agent that reports failure in a valid RESULT.json failed the stage;
  // a valid envelope does not launder a failed run into an advance.
  if (execution.result?.status === 'failed') {
    return { reason: 'agent_failed', detail: execution.result.notes_md }
  }

  // A loop edge advances on its verdict; a result without one would otherwise
  // read as silent approval.
  if (node.loopEdge && execution.result?.status === 'ok' && !execution.result.verdict) {
    return {
      reason: 'missing_verdict',
      detail: `role ${node.role} returned no verdict for loop-edged stage ${node.key}`,
    }
  }

  return null
}

/**
 * What `escalationForPark` needs for a park no agent requested, built from
 * exactly what `completeStage` already has: the just-computed round record,
 * the node's loop edge, and the caps and rounds `advance()` was itself given.
 * Empty only if `advance()` parked a stage with no loop edge, which cannot
 * happen — `escalate`, `cap_exhausted`, and `repeated_finding` are all
 * returned only from the loop-edge branch.
 */
function escalationEvidence(
  reason: 'escalate' | 'cap_exhausted' | 'repeated_finding',
  node: StageNode,
  record: RoundToRecord | undefined,
  rounds: readonly RecordedRound[],
  caps: Caps,
): EscalationInput[] {
  if (!record || !node.loopEdge) return []

  const { loop } = node.loopEdge
  if (reason === 'escalate') {
    return [
      {
        cause: 'escalate',
        nodeKey: node.key,
        loop,
        round: record.round,
        verdict: record.verdict,
        findings: record.findings,
      },
    ]
  }
  if (reason === 'cap_exhausted') {
    return [
      {
        cause: 'cap_exhausted',
        nodeKey: node.key,
        loop,
        round: record.round,
        cap: caps[LOOP_CAPS[loop]],
      },
    ]
  }

  const countedRounds = rounds.filter((round) => round.loop === loop && round.counted !== false)

  return stalledFindings(record, countedRounds, caps.repeated_finding_threshold).map((finding) => ({
    cause: 'repeated_finding' as const,
    nodeKey: node.key,
    loop,
    round: record.round,
    finding,
  }))
}

function usageRecord(telemetry: StageTelemetry | null | undefined): StageUsage {
  return {
    model: telemetry?.model ?? null,
    tokens: telemetry?.tokens ? { ...telemetry.tokens } : null,
    costUsd: telemetry?.costUsd ?? null,
    raw: telemetry?.raw ?? null,
  }
}

/**
 * Free text wins when both are given; an option answer is stored as its
 * label so the resolved card and the next stage's prompt read like the
 * owner's choice, not the id they clicked. An id with no match in the
 * decision's own option set (stale by the time it was answered) falls back
 * to the raw id rather than losing the answer.
 */
function resolveAnswerMd(
  input: { text?: string; optionId?: string },
  options: readonly DecisionOption[],
): string | null {
  const text = input.text?.trim()
  if (text) return text
  if (!input.optionId) return null

  return options.find((option) => option.id === input.optionId)?.label ?? input.optionId
}
