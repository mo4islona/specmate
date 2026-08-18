import {
  Budgets,
  Caps,
  ConversationSubjectConflictError,
  computeSpend,
  type DecisionInsert,
  type DecisionOption,
  type HarnessCoverageAssessment,
  instantiateDefinition,
  isUniqueViolation,
  nodeAt,
  PIPELINE_CATALOG,
  type PinnedGraph,
  type RecordedRound,
  type RoundToRecord,
  renderHarnessGapPrompt,
  type Spend,
  type SpendAttempt,
  type TaskState,
  type TaskType,
} from '@specmate/core'
import {
  type Conversation,
  conversationMessages,
  conversations,
  type Database,
  type DbClient,
  type Decision,
  decisions,
  events,
  iterations,
  runGraphs,
  type StageUsage,
  stages,
  type Task,
  tasks,
} from '@specmate/db'
import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm'

export class UnknownTaskTypeError extends Error {
  constructor(type: string) {
    super(`task type "${type}" is not in the pipeline catalog`)
    this.name = 'UnknownTaskTypeError'
  }
}

export class UnknownNodeError extends Error {
  constructor(node: string, pipeline: string) {
    super(`node "${node}" is not part of pipeline "${pipeline}"`)
    this.name = 'UnknownNodeError'
  }
}

export class TaskNotFoundError extends Error {
  constructor(taskId: string) {
    super(`task ${taskId} does not exist`)
    this.name = 'TaskNotFoundError'
  }
}

export class SelfDependencyError extends Error {
  constructor(taskId: string) {
    super(`task ${taskId} cannot be made to wait on itself`)
    this.name = 'SelfDependencyError'
  }
}

/** REQ-615: a task waiting on itself would never release. */
export function assertNotSelfDependency(taskId: string, blockerTaskId: string): void {
  if (taskId === blockerTaskId) throw new SelfDependencyError(taskId)
}

export interface CreateTaskInput {
  readonly slug: string
  readonly title: string
  /** The owner's request in their own words; absent on a title-only launch. */
  readonly description?: string
  readonly type: string
  readonly repoUrl: string
  readonly baseBranch?: string
  readonly caps?: Partial<Caps>
  readonly budgets?: Partial<Budgets>
  /** Dev-only: position the task at a named stage node, for manual runs until intake exists. */
  readonly at?: TaskState
}

export interface RunGraphRow {
  readonly id: string
  readonly taskId: string
  readonly version: number
  readonly dag: PinnedGraph
}

/**
 * Creating a task pins its type's definition into the task's own run graph;
 * the engine consults only that copy from here on. Caps and budgets are
 * resolved now, not merged at read time — the task records what it ran with.
 */
export async function createTask(
  db: Database,
  input: CreateTaskInput,
): Promise<{ task: Task; graph: RunGraphRow }> {
  const definition = PIPELINE_CATALOG[input.type as TaskType]
  if (!definition) throw new UnknownTaskTypeError(input.type)

  const dag = instantiateDefinition(definition)
  if (input.at && nodeAt(dag, input.at)?.kind !== 'stage') {
    throw new UnknownNodeError(input.at, definition.id)
  }

  // One transaction: a task without its pinned graph is invisible to the loop
  // and unrepairable, so the two rows exist together or not at all.
  return db.transaction(async (tx) => {
    const [task] = await tx
      .insert(tasks)
      .values({
        slug: input.slug,
        title: input.title,
        description: input.description,
        type: input.type as TaskType,
        repoUrl: input.repoUrl,
        baseBranch: input.baseBranch ?? 'main',
        status: input.at ?? 'draft',
        caps: Caps.parse(input.caps ?? {}),
        budgets: Budgets.parse(input.budgets ?? {}),
      })
      .returning()
    if (!task) throw new Error(`task ${input.slug} could not be created`)

    const [graph] = await tx
      .insert(runGraphs)
      .values({ taskId: task.id, version: 1, dag })
      .returning()
    if (!graph) throw new Error(`run graph for ${input.slug} could not be created`)

    await emitEvent(tx, {
      taskId: task.id,
      type: 'task.created',
      payload: { title: task.title },
    })

    return { task, graph }
  })
}

/**
 * Re-planning appends a version; the prior graph and its stage history stay
 * readable. The new version is instantiated from the current catalog — that is
 * the one sanctioned way a definition change reaches an existing task.
 */
export async function replanTask(db: Database, taskId: string): Promise<RunGraphRow> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1)
  if (!task) throw new TaskNotFoundError(taskId)

  const definition = PIPELINE_CATALOG[task.type]
  if (!definition) throw new UnknownTaskTypeError(task.type)

  // The read of the current version and the insert of the next one must not
  // interleave with a concurrent replan of the same task: the advisory lock
  // (the same key claim() and the engine's gate ops take) serializes them, so
  // the version read is never stale by the time its insert commits.
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${taskId}, 0))`)

    const [latest] = await tx
      .select({ version: runGraphs.version })
      .from(runGraphs)
      .where(eq(runGraphs.taskId, taskId))
      .orderBy(desc(runGraphs.version))
      .limit(1)
    const [graph] = await tx
      .insert(runGraphs)
      .values({
        taskId,
        version: (latest?.version ?? 0) + 1,
        dag: instantiateDefinition(definition),
      })
      .returning()
    if (!graph) throw new Error(`run graph v${(latest?.version ?? 0) + 1} could not be created`)

    return graph
  })
}

export async function latestGraph(db: DbClient, taskId: string): Promise<RunGraphRow | null> {
  const [graph] = await db
    .select()
    .from(runGraphs)
    .where(eq(runGraphs.taskId, taskId))
    .orderBy(desc(runGraphs.version))
    .limit(1)

  return graph ?? null
}

/**
 * One round trip for a whole poll instead of one per candidate task. Rows
 * come back ordered by version across every task at once; a task's first
 * appearance while walking that order is necessarily its highest version.
 */
export async function latestGraphsFor(
  db: DbClient,
  taskIds: readonly string[],
): Promise<Map<string, RunGraphRow>> {
  const graphs = new Map<string, RunGraphRow>()
  if (taskIds.length === 0) return graphs

  const rows = await db
    .select()
    .from(runGraphs)
    .where(inArray(runGraphs.taskId, taskIds))
    .orderBy(desc(runGraphs.version))
  for (const row of rows) {
    if (!graphs.has(row.taskId)) {
      graphs.set(row.taskId, row)
    }
  }

  return graphs
}

/**
 * Rounds recorded before `countedAfter` keep their numbers but stop counting
 * against caps — that is what "rework starts fresh counters" means in a store
 * whose round numbers are append-only.
 */
export async function roundsFor(
  db: DbClient,
  taskId: string,
  countedAfter?: Date | null,
): Promise<RecordedRound[]> {
  const rows = await db
    .select()
    .from(iterations)
    .where(eq(iterations.taskId, taskId))
    .orderBy(asc(iterations.loop), asc(iterations.round))

  return rows.map((row) => ({
    loop: row.loop,
    round: row.round,
    verdict: row.reviewerVerdict,
    findings: row.findings,
    counted: countedAfter ? row.createdAt > countedAfter : true,
  }))
}

/** The unique (task, loop, round) index is the arbiter against double-recording. */
export async function recordRound(
  db: DbClient,
  taskId: string,
  round: RoundToRecord,
): Promise<void> {
  await db
    .insert(iterations)
    .values({
      taskId,
      loop: round.loop,
      round: round.round,
      reviewerVerdict: round.verdict,
      findings: [...round.findings],
    })
    .onConflictDoNothing()
}

export async function lastReworkAt(db: DbClient, taskId: string): Promise<Date | null> {
  const [row] = await db
    .select({ createdAt: events.createdAt })
    .from(events)
    .where(sql`${events.taskId} = ${taskId} and ${events.type} = 'gate.reworked'`)
    .orderBy(desc(events.seq))
    .limit(1)

  return row?.createdAt ?? null
}

/** A restart's watermark for the attempt-cap streak — see `Engine.capSpent`. */
export async function lastRestartAt(db: DbClient, taskId: string): Promise<Date | null> {
  const [row] = await db
    .select({ createdAt: events.createdAt })
    .from(events)
    .where(sql`${events.taskId} = ${taskId} and ${events.type} = 'task.restarted'`)
    .orderBy(desc(events.seq))
    .limit(1)

  return row?.createdAt ?? null
}

export async function countRedirects(db: DbClient, taskId: string, gate: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(events)
    .where(
      sql`${events.taskId} = ${taskId} and ${events.type} = 'gate.redirected' and ${events.payload}->>'gate' = ${gate}`,
    )

  return row?.n ?? 0
}

/**
 * REQ-1501: sums every attempt charged to the task — finished stage runs and
 * every settled conversation-response attempt — computed fresh from the rows
 * each time, never from a running total (design.md: a derived sum cannot
 * drift from the records it derives from). A stage still `running` has no
 * `finishedAt` yet and is excluded outright, not counted with an unreported
 * cost: it has not run out, it just has not finished.
 */
export async function taskSpend(db: DbClient, taskId: string): Promise<Spend> {
  const [stageRows, messageRows] = await Promise.all([
    db
      .select({ cost: stages.cost, startedAt: stages.startedAt, finishedAt: stages.finishedAt })
      .from(stages)
      .where(and(eq(stages.taskId, taskId), isNotNull(stages.finishedAt))),
    db
      .select({ telemetry: conversationMessages.telemetry })
      .from(conversationMessages)
      .innerJoin(conversations, eq(conversationMessages.conversationId, conversations.id))
      .where(eq(conversations.taskId, taskId)),
  ])

  const attempts: SpendAttempt[] = [
    ...stageRows.map(
      (row): SpendAttempt => ({
        costUsd: (row.cost as StageUsage).costUsd ?? null,
        durationMs:
          row.startedAt && row.finishedAt
            ? row.finishedAt.getTime() - row.startedAt.getTime()
            : null,
      }),
    ),
    ...messageRows.flatMap((row) =>
      row.telemetry.map(
        (entry): SpendAttempt => ({
          costUsd: entry.costUsd ?? null,
          durationMs: entry.durationMs ?? null,
        }),
      ),
    ),
  ]

  return computeSpend(attempts)
}

/**
 * A request or an engine escalation becomes a durable decision, matched by
 * (node, key) while open — a retry attaches instead of duplicating. A freshly
 * created decision also opens its inert scoped conversation, in the same
 * transaction: raising a decision creates one place to discuss it, without
 * spending a model run.
 */
export async function raiseDecision(
  db: DbClient,
  taskId: string,
  stageId: string | null,
  input: DecisionInsert,
): Promise<{ decision: Decision; created: boolean }> {
  const [open] = await findOpenDecision(db, taskId, input)
  if (open) return attachToOpenDecision(db, taskId, stageId, open, input)

  let created: Decision | undefined
  try {
    ;[created] = await db
      .insert(decisions)
      .values({
        taskId,
        stageId: stageId ?? undefined,
        nodeKey: input.nodeKey,
        key: input.key,
        kind: input.kind,
        promptMd: input.promptMd,
        options: [...input.options],
        blocking: input.blocking,
      })
      .returning()
  } catch (error) {
    // The "attach, don't duplicate" contract above only holds under the
    // task's advisory lock; a caller that races this insert without it hits
    // the partial unique index instead — attach to the winner rather than
    // surfacing a raw constraint violation.
    if (isUniqueViolation(error)) {
      const [existing] = await findOpenDecision(db, taskId, input)
      if (existing) return attachToOpenDecision(db, taskId, stageId, existing, input)
    }

    throw error
  }
  if (!created) throw new Error(`decision "${input.key}" at ${input.nodeKey} could not be created`)

  await emitEvent(db, {
    taskId,
    stageId: stageId ?? undefined,
    type: 'decision.raised',
    payload: {
      decisionId: created.id,
      nodeKey: input.nodeKey,
      key: input.key,
      kind: input.kind,
      blocking: input.blocking,
    },
  })

  let conversation: Conversation | undefined
  try {
    ;[conversation] = await db
      .insert(conversations)
      .values({ taskId, subjectKind: 'decision', subjectId: created.id })
      .returning()
  } catch (error) {
    // Mirrors insertConversationOrConflict: the store has no typed "already
    // exists" result, so the partial unique index's violation is the only
    // signal a race collided with an existing conversation for this decision.
    if (isUniqueViolation(error)) {
      throw new ConversationSubjectConflictError(taskId, 'decision', created.id)
    }

    throw error
  }
  if (!conversation) throw new Error(`conversation for decision ${created.id} could not be created`)

  await emitEvent(db, {
    taskId,
    type: 'conversation.created',
    payload: { conversationId: conversation.id, subjectKind: 'decision', subjectId: created.id },
  })

  return { decision: created, created: true }
}

function findOpenDecision(db: DbClient, taskId: string, input: DecisionInsert) {
  return db
    .select()
    .from(decisions)
    .where(
      and(
        eq(decisions.taskId, taskId),
        eq(decisions.nodeKey, input.nodeKey),
        eq(decisions.key, input.key),
        eq(decisions.status, 'open'),
      ),
    )
    .limit(1)
}

/**
 * A re-ask at the same (node, key) attaches to the still-open decision rather
 * than duplicating it — but a retried or corrected stage may have changed
 * what it's asking, or run as a later attempt, and neither must be lost
 * underneath an unchanged identity.
 */
async function attachToOpenDecision(
  db: DbClient,
  taskId: string,
  stageId: string | null,
  open: Decision,
  input: DecisionInsert,
): Promise<{ decision: Decision; created: boolean }> {
  const unchanged =
    open.stageId === (stageId ?? null) &&
    open.kind === input.kind &&
    open.promptMd === input.promptMd &&
    open.blocking === input.blocking &&
    Bun.deepEquals(open.options, input.options)
  if (unchanged) return { decision: open, created: false }

  const [updated] = await db
    .update(decisions)
    .set({
      stageId: stageId ?? undefined,
      kind: input.kind,
      promptMd: input.promptMd,
      options: [...input.options],
      blocking: input.blocking,
    })
    .where(eq(decisions.id, open.id))
    .returning()
  const decision = updated ?? open

  await emitEvent(db, {
    taskId,
    stageId: stageId ?? undefined,
    type: 'decision.raised',
    payload: {
      decisionId: decision.id,
      nodeKey: input.nodeKey,
      key: input.key,
      kind: input.kind,
      blocking: input.blocking,
    },
  })

  return { decision, created: false }
}

/**
 * The coverage decision's fixed identity (REQ-1403): raised at `human_kickoff_gate` regardless
 * of which probing node (`planning` or `kickoff_brief`) completed, so both attach to the same
 * open record rather than raising two. `nodeKey` names where it belongs, not who raised it.
 */
export const COVERAGE_DECISION_NODE_KEY: TaskState = 'human_kickoff_gate'
export const COVERAGE_DECISION_KEY = 'harness-coverage'

export const COVERAGE_OPTIONS: readonly DecisionOption[] = [
  { id: 'split', label: 'Build the harness first' },
  { id: 'proceed', label: 'Proceed without it' },
  { id: 'cancel', label: 'Cancel this task' },
]

/**
 * REQ-1401, REQ-1403: the durable half of what a probing stage's result carries — the
 * classification lands on the task, and a gap short of adequate gets (or keeps) an open
 * decision offering the three-way choice. Idempotent across repeated probing completions
 * (`planning` then `kickoff_brief`): `raiseDecision` attaches to the still-open record instead
 * of duplicating it.
 */
export async function recordHarnessCoverage(
  db: DbClient,
  taskId: string,
  stageId: string,
  assessment: HarnessCoverageAssessment,
): Promise<void> {
  await db
    .update(tasks)
    .set({ harnessStatus: assessment.classification, updatedAt: new Date() })
    .where(eq(tasks.id, taskId))

  if (assessment.classification === 'adequate') {
    await dismissCoverageDecision(db, taskId, 'system', 'reclassified')

    return
  }

  await raiseDecision(db, taskId, stageId, {
    nodeKey: COVERAGE_DECISION_NODE_KEY,
    key: COVERAGE_DECISION_KEY,
    kind: 'question',
    promptMd: renderHarnessGapPrompt(assessment),
    options: COVERAGE_OPTIONS,
    blocking: false,
  })
}

/** Resolves the open coverage decision, if any, without touching any other open decision. */
export async function dismissCoverageDecision(
  db: DbClient,
  taskId: string,
  actor: string,
  cause: string,
): Promise<void> {
  const [dismissed] = await db
    .update(decisions)
    .set({ status: 'dismissed', answeredBy: actor, answeredAt: new Date() })
    .where(
      and(
        eq(decisions.taskId, taskId),
        eq(decisions.nodeKey, COVERAGE_DECISION_NODE_KEY),
        eq(decisions.key, COVERAGE_DECISION_KEY),
        eq(decisions.status, 'open'),
      ),
    )
    .returning({ id: decisions.id, stageId: decisions.stageId })
  if (!dismissed) return

  await emitEvent(db, {
    taskId,
    stageId: dismissed.stageId ?? undefined,
    type: 'decision.dismissed',
    payload: {
      decisionId: dismissed.id,
      nodeKey: COVERAGE_DECISION_NODE_KEY,
      key: COVERAGE_DECISION_KEY,
      actor,
      cause,
    },
  })
}

/**
 * The evidence behind the task's current `harnessStatus` — read back from the
 * most recent probing stage's own result (REQ-1401: data, never a task
 * column re-deriving it) rather than parsed from any rendered prompt.
 */
export async function latestHarnessCoverage(
  db: DbClient,
  taskId: string,
): Promise<HarnessCoverageAssessment | null> {
  const [row] = await db
    .select({ result: stages.result })
    .from(stages)
    .where(and(eq(stages.taskId, taskId), sql`${stages.result} ->> 'harness_coverage' is not null`))
    .orderBy(desc(stages.finishedAt))
    .limit(1)

  return row?.result?.harness_coverage ?? null
}

export interface EngineEvent {
  readonly taskId: string
  readonly stageId?: string
  readonly type: string
  readonly payload?: Record<string, unknown>
}

export async function emitEvent(db: DbClient, event: EngineEvent): Promise<void> {
  await db.insert(events).values({
    taskId: event.taskId,
    stageId: event.stageId,
    type: event.type,
    payload: event.payload ?? {},
  })
}
