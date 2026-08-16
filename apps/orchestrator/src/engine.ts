import {
  advance,
  bindStageProvider,
  canTransition,
  type GateNode,
  nodeAt,
  type PinnedGraph,
  type ProviderId,
  type StageNode,
  type StageTelemetry,
  type TaskState,
} from '@specmate/core'
import {
  type Database,
  type DbClient,
  feedback,
  type Stage,
  type StageUsage,
  stages,
  type Task,
  tasks,
} from '@specmate/db'
import type { StageExecution } from '@specmate/runner'
import type { Workspace } from '@specmate/workspace'
import { and, asc, count, desc, eq, notInArray, sql } from 'drizzle-orm'
import {
  countRedirects,
  emitEvent,
  lastReworkAt,
  latestGraph,
  type RunGraphRow,
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

/** What the engine needs from the workspace layer; the entry point adapts `WorkspaceService`. */
export interface EngineWorkspaces {
  provision(request: {
    taskId: string
    slug: string
    repoUrl: string
    baseBranch: string
  }): Promise<Workspace>
  discard(workspace: Workspace): Promise<void>
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

export interface EngineSettings {
  readonly stageConcurrency: number
  readonly stageAttemptCap: number
  readonly availableProviders: readonly ProviderId[]
}

export interface ReworkOptions {
  readonly taskId: string
  readonly actor: string
  readonly target: TaskState
  readonly comment?: string
}

export interface EngineDeps {
  readonly db: Database
  readonly workspaces: EngineWorkspaces
  readonly settings: EngineSettings
  /** Absent in ops-only contexts (the admin CLI); tick() requires it. */
  readonly dispatcher?: StageDispatcher
  /** Kills executions found by label during the sweep; absent means nothing to kill. */
  readonly killOrphans?: (labels: Record<string, string>) => Promise<string[]>
  readonly log?: (message: string) => void
}

/** Statuses the poll never dispatches from: interrupts, terminals, and the drafting board. */
const NOT_RUNNABLE: TaskState[] = [
  'draft',
  'waiting_human',
  'paused',
  'blocked',
  'archived',
  'cancelled',
  'failed',
]

/**
 * The loop. Picks up runnable tasks, walks each along its pinned graph through
 * dispatch → outcome → advance, and exposes the gate operations the future UI
 * will call. Deliberately free of role-, type-, or node-specific branching:
 * anything that wants to branch must become definition data.
 */
export class Engine {
  private readonly inFlight = new Set<Promise<void>>()

  constructor(private readonly deps: EngineDeps) {}

  /** Waits for every dispatched stage to settle; tests and shutdown use this. */
  async idle(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.allSettled([...this.inFlight])
  }

  /**
   * One poll: select tasks positioned at a stage node with nothing in flight,
   * claim under a per-task advisory lock, dispatch up to the concurrency cap.
   * Stage executions run detached — a stage takes minutes, a tick must not.
   */
  async tick(): Promise<number> {
    const { db, settings, dispatcher } = this.deps
    if (!dispatcher) throw new Error('this engine has no dispatcher; tick() is not available')

    const [running] = await db
      .select({ n: count() })
      .from(stages)
      .where(eq(stages.status, 'running'))
    const slots = settings.stageConcurrency - (running?.n ?? 0)
    if (slots <= 0) return 0

    const candidates = await db
      .select()
      .from(tasks)
      .where(notInArray(tasks.status, NOT_RUNNABLE))
      .orderBy(asc(tasks.updatedAt))

    let dispatched = 0
    for (const task of candidates) {
      if (dispatched >= slots) break
      const graph = await latestGraph(db, task.id)
      if (!graph) continue
      const node = nodeAt(graph.dag, task.status)
      if (node?.kind !== 'stage') continue
      const provider = await this.resolveProvider(graph, node)
      const claimed = await this.claim(task, graph, node, provider)
      if (!claimed) continue

      dispatched += 1
      const run = this.runStage(task, graph, node, claimed, dispatcher)
        .catch((e: Error) => {
          this.deps.log?.(
            `stage ${task.id}/${node.key} attempt ${claimed.attempt} did not settle: ${e.message}`,
          )
        })
        .finally(() => {
          this.inFlight.delete(run)
        })
      this.inFlight.add(run)
    }

    return dispatched
  }

  /**
   * The claim is transactional: the advisory lock makes an accidental second
   * orchestrator skip rather than double-dispatch, and the (graph, node,
   * attempt) unique index is the arbiter if even that fails.
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

      const [prior] = await tx
        .select({ attempt: stages.attempt })
        .from(stages)
        .where(and(eq(stages.graphId, graph.id), eq(stages.nodeKey, node.key)))
        .orderBy(desc(stages.attempt))
        .limit(1)
      const [row] = await tx
        .insert(stages)
        .values({
          taskId: task.id,
          graphId: graph.id,
          nodeKey: node.key,
          role: node.role,
          provider,
          status: 'running',
          attempt: (prior?.attempt ?? -1) + 1,
          startedAt: new Date(),
        })
        .returning()

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
      await this.completeStage(task, graph, node, row, execution)
    } catch (e) {
      log?.(
        `bookkeeping after ${task.id}/${node.key} attempt ${row.attempt}: ${(e as Error).message}`,
      )
    }
  }

  private async completeStage(
    task: Task,
    graph: RunGraphRow,
    node: StageNode,
    row: Stage,
    execution: StageExecution,
  ): Promise<void> {
    const { db } = this.deps
    const result = execution.result
    if (!result) throw new Error(`stage ${row.id} succeeded without a result`)

    await db
      .update(stages)
      .set({
        status: 'succeeded',
        finishedAt: new Date(),
        cost: usageRecord(execution.telemetry),
        result,
        updatedAt: new Date(),
      })
      .where(eq(stages.id, row.id))
    await emitEvent(db, {
      taskId: task.id,
      stageId: row.id,
      type: 'stage.completed',
      payload: { node: node.key, attempt: row.attempt, verdict: result.verdict ?? null },
    })

    const reworkedAt = await lastReworkAt(db, task.id)
    const rounds = await roundsFor(db, task.id, reworkedAt)
    const decision = advance(
      graph.dag,
      node.key,
      {
        status: result.status === 'needs_decision' ? 'needs_decision' : 'ok',
        verdict: result.verdict,
        findings: result.findings,
      },
      rounds,
      task.caps,
    )

    if (decision.record) await recordRound(db, task.id, decision.record)
    if (decision.kind === 'park') {
      await this.applyTransition(db, task, graph.dag, 'waiting_human', {
        cause: decision.reason,
        resume: decision.resume,
        stageId: row.id,
      })

      return
    }

    await this.applyTransition(db, task, graph.dag, decision.to, {
      cause: decision.kind === 'loop' ? 'revise' : 'advance',
      stageId: row.id,
    })
    await this.releaseIfTerminal(task, graph.dag, decision.to)
  }

  /**
   * One dispatch is one attempt, whatever the runner retried internally.
   * While attempts remain the workspace is discarded and the next tick
   * re-dispatches; a spent cap fails the task naming the stage — never silently.
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
    const { db, workspaces, log } = this.deps
    await db
      .update(stages)
      .set({
        status: 'failed',
        finishedAt: new Date(),
        cost: { ...usageRecord(telemetry), failure: { reason, detail } },
        updatedAt: new Date(),
      })
      .where(eq(stages.id, row.id))
    await emitEvent(db, {
      taskId: task.id,
      stageId: row.id,
      type: 'stage.failed',
      payload: { node: node.key, attempt: row.attempt, reason, detail: detail ?? null },
    })

    if (await this.capSpent(graph.id, node.key)) {
      await this.applyTransition(db, task, graph.dag, 'failed', {
        cause: reason,
        resume: node.key,
        stageId: row.id,
        payload: { stage: node.key, reason, detail: detail ?? null },
      })

      return
    }

    // Only while attempts remain: a task out of attempts leaves its tree as
    // evidence, which is what the human will be asked to look at.
    if (workspace) {
      await workspaces.discard(workspace).catch((e: Error) => {
        log?.(`discard after failed attempt on ${task.id}/${node.key}: ${e.message}`)
      })
    }
  }

  /**
   * The cap counts consecutive trailing failures of this node: a loop edge
   * revisiting the node starts a fresh streak at its success, so prior rounds
   * do not eat the retry budget.
   */
  private async capSpent(graphId: string, nodeKey: string): Promise<boolean> {
    const rows = await this.deps.db
      .select({ status: stages.status })
      .from(stages)
      .where(and(eq(stages.graphId, graphId), eq(stages.nodeKey, nodeKey)))
      .orderBy(desc(stages.attempt))
    let streak = 0
    for (const row of rows) {
      if (row.status !== 'failed') break
      streak += 1
    }

    return streak >= this.deps.settings.stageAttemptCap
  }

  /**
   * Startup sweep: a stage recorded running with no orchestrator behind it is
   * a failed attempt. Kill whatever its labels still name, update the record
   * in place, and let the next tick re-dispatch under the same cap. Parked and
   * gated tasks are not touched.
   */
  async sweep(): Promise<number> {
    const { db, log } = this.deps
    const orphans = await db
      .select({ stage: stages, task: tasks })
      .from(stages)
      .innerJoin(tasks, eq(stages.taskId, tasks.id))
      .where(eq(stages.status, 'running'))

    for (const { stage: row, task } of orphans) {
      try {
        await this.settleOrphan(task, row)
      } catch (e) {
        log?.(`sweep: settling ${task.id}/${row.nodeKey} failed: ${(e as Error).message}`)
      }
    }

    return orphans.length
  }

  private async settleOrphan(task: Task, row: Stage): Promise<void> {
    const { db, workspaces, killOrphans, log } = this.deps
    log?.(
      `sweep: task ${task.id} node ${row.nodeKey} attempt ${row.attempt} was recorded running with no live execution`,
    )
    const killed =
      (await killOrphans?.({
        'specmate.task': task.id,
        'specmate.node': row.nodeKey,
      }).catch(() => [])) ?? []
    for (const id of killed) log?.(`sweep: killed ${id}`)

    await db
      .update(stages)
      .set({
        status: 'failed',
        finishedAt: new Date(),
        cost: { ...(row.cost ?? {}), failure: { reason: 'orphaned' } },
        updatedAt: new Date(),
      })
      .where(eq(stages.id, row.id))
    await emitEvent(db, {
      taskId: task.id,
      stageId: row.id,
      type: 'stage.failed',
      payload: { node: row.nodeKey, attempt: row.attempt, reason: 'orphaned' },
    })

    // The cap is judged against the orphaned row's own graph and node — the
    // latest graph and task.status may have diverged from it (a replan).
    if (await this.capSpent(row.graphId, row.nodeKey)) {
      const graph = await latestGraph(db, task.id)
      if (graph && canTransition(graph.dag, task.status, 'failed')) {
        await this.applyTransition(db, task, graph.dag, 'failed', {
          cause: 'orphaned',
          resume: row.nodeKey as TaskState,
          stageId: row.id,
          payload: { stage: row.nodeKey, reason: 'orphaned' },
        })
      }

      // Out of attempts: the tree stays exactly as the dead attempt left it —
      // the evidence a human will be asked to look at, as in failAttempt.
      return
    }

    // Attempts remain: reset the tree so the retry starts from committed state.
    try {
      const workspace = await workspaces.provision({
        taskId: task.id,
        slug: task.slug,
        repoUrl: task.repoUrl,
        baseBranch: task.baseBranch,
      })
      await workspaces.discard(workspace)
    } catch (e) {
      log?.(`sweep: workspace discard for ${task.id} failed: ${(e as Error).message}`)
    }
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
      await tx.insert(feedback).values({ taskId, kind: 'redirect', textMd: comment ?? '' })

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

      if (comment !== undefined) {
        await tx.insert(feedback).values({ taskId, kind: 'rework', textMd: comment })
      }

      await emitEvent(tx, {
        taskId,
        type: 'gate.reworked',
        payload: { gate: gate.key, to: target, actor, comment: comment ?? null },
      })
      await this.applyTransition(tx, task, graph.dag, target, { cause: 'rework', actor })
    })
  }

  /** Returns a parked task to the exact state it stopped in. */
  async resume(taskId: string, actor: string): Promise<void> {
    await this.withTaskLock(taskId, async (tx) => {
      const { task, graph } = await this.taskWithGraph(taskId, tx)
      if (task.status !== 'waiting_human' && task.status !== 'paused') {
        throw new NotParkedError(taskId, task.status)
      }
      const to = task.resumeStatus
      if (!to) throw new NoResumeStateError(taskId)

      await emitEvent(tx, { taskId, type: 'task.resumed', payload: { to, actor } })
      await this.applyTransition(tx, task, graph.dag, to, { cause: 'resume', actor })
    })
  }

  /** Failure is recoverable: re-enter the failed stage, or any stage named explicitly. */
  async restart(taskId: string, actor: string, to?: TaskState): Promise<void> {
    await this.withTaskLock(taskId, async (tx) => {
      const { task, graph } = await this.taskWithGraph(taskId, tx)
      if (task.status !== 'failed') throw new NotRestartableError(taskId, task.status)
      const target = to ?? task.resumeStatus
      if (!target) throw new NoResumeStateError(taskId)

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
  }

  /**
   * Housekeeping belongs to the engine, not to any stage: archive and cancel
   * release the working tree while the mirror keeps the branch. Runs after the
   * transition commits — the release layer re-reads the task and must see the
   * terminal status.
   */
  private async releaseIfTerminal(task: Task, dag: PinnedGraph, to: TaskState): Promise<void> {
    if (to !== dag.terminal && to !== 'cancelled') return

    await this.deps.workspaces.release(task.id).catch((e: Error) => {
      this.deps.log?.(`workspace release for ${task.id}: ${e.message}`)
    })
  }
}

interface StageDefectRecord {
  readonly reason: string
  readonly detail?: string
}

/** What, if anything, makes this execution a failed attempt instead of a completion. */
function stageDefect(node: StageNode, execution: StageExecution): StageDefectRecord | null {
  if (execution.status !== 'succeeded') {
    return { reason: execution.failure ?? 'unknown', detail: execution.detail }
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

function usageRecord(telemetry: StageTelemetry | null | undefined): StageUsage {
  return {
    model: telemetry?.model ?? null,
    tokens: telemetry?.tokens ? { ...telemetry.tokens } : null,
    costUsd: telemetry?.costUsd ?? null,
    raw: telemetry?.raw ?? null,
  }
}
