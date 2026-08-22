import {
  BUDGET_DECISION_KEY,
  BUDGET_DECISION_NODE_KEY,
  Budgets,
  Caps,
  ConversationSubjectConflictError,
  computeSpend,
  type DecisionInsert,
  type DecisionOption,
  definitionForSize,
  type HarnessCoverageAssessment,
  instantiateDefinition,
  isUniqueViolation,
  type ModelBindingsOverride,
  needsPlanChoice,
  nodeAt,
  PIPELINE_CATALOG,
  type PinnedGraph,
  type PipelineDefinition,
  type PlanChoice,
  type PlanShape,
  type RecordedRound,
  type RoundToRecord,
  renderInheritedWaiverPrompt,
  renderPlanChoicePrompt,
  resolveModelBindings,
  type Spend,
  type SpendAttempt,
  type TaskState,
  type TaskType,
} from '@specmate/core'
import {
  type Conversation,
  type CoverageWaiver,
  conversationMessages,
  conversations,
  coverageWaivers,
  type Database,
  type DbClient,
  type Decision,
  decisions,
  events,
  getModelDefaults,
  iterations,
  runGraphs,
  type StageUsage,
  stages,
  type Task,
  tasks,
} from '@specmate/db'
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm'

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
  /** Per-role, per-field override; unnamed roles/fields resolve from the current model-defaults setting. */
  readonly modelBindings?: ModelBindingsOverride
  /** Start at a named stage node instead of the pipeline's entry — skips the stages before it. */
  readonly at?: TaskState
  /** The task whose plan created this one; absent for a task the owner launched (REQ-617). */
  readonly originTaskId?: string
  /** Depth in the chain that plan started. Zero unless created from a plan. */
  readonly planDepth?: number
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
  // One transaction: a task without its pinned graph is invisible to the loop
  // and unrepairable, so the two rows exist together or not at all.
  return db.transaction((tx) => createTaskInTx(tx, input))
}

/**
 * The same create for a caller that already holds a transaction. The split
 * creates its prerequisites and blocks their parent on them as one unit — a
 * prerequisite that exists while nothing waits on it is work nobody asked for,
 * and the decision that authorised it is already answered.
 */
export async function createTaskInTx(
  db: DbClient,
  input: CreateTaskInput,
): Promise<{ task: Task; graph: RunGraphRow }> {
  const definition = PIPELINE_CATALOG[input.type as TaskType]
  if (!definition) throw new UnknownTaskTypeError(input.type)

  const dag = instantiateDefinition(definition)
  if (input.at && nodeAt(dag, input.at)?.kind !== 'stage') {
    throw new UnknownNodeError(input.at, definition.id)
  }

  // Read inside the transaction: the resolved bindings this task stores must
  // reflect the model-defaults row as of this create, not a stale snapshot.
  const currentDefaults = await getModelDefaults(db)

  const [task] = await db
    .insert(tasks)
    .values({
      slug: input.slug,
      title: input.title,
      description: input.description,
      type: input.type as TaskType,
      repoUrl: input.repoUrl,
      baseBranch: input.baseBranch ?? 'main',
      // `draft` is a reserved state the poll never dispatches, so a task
      // created there waits forever with nothing to advance it. Creating is
      // launching: the task starts at its pipeline's entry node.
      status: input.at ?? dag.entry,
      caps: Caps.parse(input.caps ?? {}),
      budgets: Budgets.parse(input.budgets ?? {}),
      modelBindings: resolveModelBindings(currentDefaults, input.modelBindings),
      originTaskId: input.originTaskId ?? null,
      planDepth: input.planDepth ?? 0,
    })
    .returning()
  if (!task) throw new Error(`task ${input.slug} could not be created`)

  const [graph] = await db
    .insert(runGraphs)
    .values({ taskId: task.id, version: 1, dag })
    .returning()
  if (!graph) throw new Error(`run graph for ${input.slug} could not be created`)

  await emitEvent(db, {
    taskId: task.id,
    type: 'task.created',
    payload: { title: task.title },
  })

  return { task, graph }
}

/**
 * Appends the next version of a task's graph. Both callers — an explicit
 * replan and the profile swap a declared size triggers — go through here, so
 * the version read and its insert are never two different pieces of arithmetic.
 * Must run inside a transaction already holding the task's advisory lock.
 */
export async function appendRunGraph(
  tx: DbClient,
  taskId: string,
  definition: PipelineDefinition,
): Promise<RunGraphRow> {
  const [latest] = await tx
    .select({ version: runGraphs.version })
    .from(runGraphs)
    .where(eq(runGraphs.taskId, taskId))
    .orderBy(desc(runGraphs.version))
    .limit(1)
  const version = (latest?.version ?? 0) + 1

  const [graph] = await tx
    .insert(runGraphs)
    .values({ taskId, version, dag: instantiateDefinition(definition) })
    .returning()
  if (!graph) throw new Error(`run graph v${version} could not be created`)

  return graph
}

/**
 * Re-planning appends a version; the prior graph and its stage history stay
 * readable. The new version is instantiated from the current catalog — that is
 * the one sanctioned way a definition change reaches an existing task.
 */
export async function replanTask(db: Database, taskId: string): Promise<RunGraphRow> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1)
  if (!task) throw new TaskNotFoundError(taskId)

  // A task that already declared a size keeps the profile that size selects;
  // a replan is a fresh copy of the definition, not a reset of the shape.
  const definition = task.planSize
    ? definitionForSize(task.type, task.planSize)
    : PIPELINE_CATALOG[task.type]
  if (!definition) throw new UnknownTaskTypeError(task.type)

  // The read of the current version and the insert of the next one must not
  // interleave with a concurrent replan of the same task: the advisory lock
  // (the same key claim() and the engine's gate ops take) serializes them, so
  // the version read is never stale by the time its insert commits.
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${taskId}, 0))`)

    return appendRunGraph(tx, taskId, definition)
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

/**
 * REQ-1202: what makes two requests the same request. A non-blocking question
 * is about the work, so the task and the key identify it however many nodes
 * ask; everything else is about a node — two nodes escalating are two
 * situations with two pieces of evidence.
 *
 * Two things the (task, key) widening must not do. It must not reach across
 * kinds: a non-blocking question that attached to an open escalation would
 * rewrite it into a question and take the block off a parked task. And it must
 * not reach into an engine identity: an agent question keyed `harness-coverage`
 * would capture the coverage decision, which `isCoverageDecision` and both
 * resolution paths then fail to find by (node, key), clearing the gate with the
 * gap neither accepted nor recorded.
 */
function findOpenDecision(db: DbClient, taskId: string, input: DecisionInsert) {
  const engineOwned = ENGINE_DECISION_IDENTITIES.some(
    (identity) => identity.nodeKey === input.nodeKey && identity.key === input.key,
  )
  const byTaskAndKey = !engineOwned && !input.blocking && input.kind === 'question'

  const scope = byTaskAndKey
    ? [
        // At its own node a re-ask attaches whatever it now calls itself: a
        // corrected retry may change kind or blocking, and that is an update to
        // one record, not a second one. Across nodes only another non-blocking
        // question is the same question — attaching to an open escalation would
        // rewrite it into a question and take the block off a parked task.
        or(
          eq(decisions.nodeKey, input.nodeKey),
          and(eq(decisions.kind, 'question'), eq(decisions.blocking, false)),
        ),
        ...ENGINE_DECISION_IDENTITIES.filter((identity) => identity.key === input.key).map(
          (identity) => ne(decisions.nodeKey, identity.nodeKey),
        ),
      ]
    : [eq(decisions.nodeKey, input.nodeKey)]

  return (
    db
      .select()
      .from(decisions)
      .where(
        and(
          eq(decisions.taskId, taskId),
          ...scope,
          eq(decisions.key, input.key),
          eq(decisions.status, 'open'),
        ),
      )
      // `decisions_open_node_key_idx` is unique per (task, node, key) while
      // open, so the widened match can still see several rows. Oldest first:
      // the record a re-ask should attach to is the one already being answered.
      .orderBy(asc(decisions.createdAt), asc(decisions.id))
      .limit(1)
  )
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

/**
 * The identities the engine raises for itself. They are matched by (node, key)
 * everywhere they are resolved, so nothing else may attach to one.
 */
const ENGINE_DECISION_IDENTITIES: readonly { readonly nodeKey: TaskState; readonly key: string }[] =
  [
    { nodeKey: COVERAGE_DECISION_NODE_KEY, key: COVERAGE_DECISION_KEY },
    { nodeKey: BUDGET_DECISION_NODE_KEY, key: BUDGET_DECISION_KEY },
  ]

/**
 * The option set is computed, never filtered after the fact: a task at the depth
 * cap is offered no split at all, so the recursion is closed by the engine
 * rather than by a prompt anyone has to be trusted to obey (REQ-617).
 */
export function planChoiceOptions(choice: PlanChoice): DecisionOption[] {
  const splitLabel = choice.creates.length > 0 ? 'Do that work first' : 'Build the harness first'
  const proceedLabel = choice.creates.length > 0 ? 'Proceed as one task' : 'Proceed without it'

  return [
    ...(choice.splittable ? [{ id: 'split', label: splitLabel }] : []),
    { id: 'proceed', label: proceedLabel },
    { id: 'cancel', label: 'Cancel this task' },
  ]
}

/** What the owner would be choosing between, given a task's plan, its coverage, and its caps. */
export function planChoiceFor(
  task: Task,
  assessment: HarnessCoverageAssessment | null,
  plan: PlanShape | null,
): PlanChoice {
  const proposed = plan?.prerequisites ?? []
  const depthCap = task.caps.max_plan_depth
  const splittable = task.planDepth < depthCap

  // At the depth cap nothing may be created at all, so everything proposed is
  // dropped — and still named. The alternative, dropping them silently, is the
  // failure this whole change exists to remove.
  const creates = splittable ? proposed.slice(0, task.caps.max_prerequisite_tasks) : []
  const dropped = splittable ? proposed.slice(task.caps.max_prerequisite_tasks) : proposed
  const dropReason = dropped.length === 0 ? null : splittable ? 'count' : 'depth'

  return { assessment, creates, dropped, dropReason, splittable, depthCap }
}

/**
 * REQ-1401, REQ-1403, REQ-1306: the durable half of what a planning stage's result carries.
 * The classification and the declared size land on the task, and either a coverage gap or a
 * plan proposing work first gets (or keeps) the one open decision. Idempotent across repeated
 * completions (`planning` then `kickoff_brief`): `raiseDecision` attaches to the still-open
 * record instead of duplicating it, refreshing the prompt when the second pass changed it.
 */
export async function recordPlanOutcome(
  db: DbClient,
  task: Task,
  stageId: string,
  assessment: HarnessCoverageAssessment | null,
  plan: PlanShape | null,
  runningPipelineId: string,
): Promise<void> {
  // REQ-408: the column says what the task is running, so it is written only
  // where the graph agrees. `kickoff_brief` repeats the size — and nothing
  // forces it to repeat it faithfully — while the profile swap deliberately
  // refuses to act that late; storing it anyway would leave `planSize` naming
  // a profile the task is not on, which `replanTask` would then pin.
  const sizeApplies =
    plan !== null && definitionForSize(task.type, plan.size).id === runningPipelineId

  await db
    .update(tasks)
    .set({
      ...(assessment ? { harnessStatus: assessment.classification } : {}),
      ...(sizeApplies && plan ? { planSize: plan.size } : {}),
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, task.id))

  if (plan) {
    await emitEvent(db, {
      taskId: task.id,
      stageId,
      type: 'task.plan_recorded',
      payload: {
        size: plan.size,
        applied: sizeApplies,
        prerequisites: plan.prerequisites.map((prerequisite) => prerequisite.key),
      },
    })
  }

  // REQ-1406: an acceptance is spent once the gap it accepted is gone, so an
  // adequate classification ends it rather than leaving it to shadow a
  // repository that has since grown a harness.
  if (assessment?.classification === 'adequate') {
    await revokeCoverageWaiverInForce(db, task.repoUrl)
  }

  const inherited =
    assessment && assessment.classification !== 'adequate'
      ? await inheritCoverageWaiver(db, task, stageId, assessment)
      : false

  // An inherited acceptance settles the coverage half and nothing else: a plan
  // proposing tasks is a different question the owner has not answered yet.
  const choice = planChoiceFor(task, inherited ? null : assessment, plan)
  if (!needsPlanChoice(choice)) {
    // An open card closed because the gap was inherited was not reclassified —
    // the classification stands, someone else already accepted it.
    await dismissCoverageDecision(db, task.id, 'system', inherited ? 'inherited' : 'reclassified')

    return
  }

  await raiseDecision(db, task.id, stageId, {
    nodeKey: COVERAGE_DECISION_NODE_KEY,
    key: COVERAGE_DECISION_KEY,
    kind: 'question',
    promptMd: renderPlanChoicePrompt(choice),
    options: planChoiceOptions(choice),
    blocking: false,
  })
}

/**
 * REQ-1406: a gap the owner already accepted for this repository is not asked
 * about again. The inheritance is written as an already-resolved decision at
 * the identity the choice would have used, so it reaches the decision log
 * every later stage reads (REQ-1205) and the task's own view, while never
 * showing up as something the owner must act on.
 *
 * Returns whether an acceptance was in force.
 */
async function inheritCoverageWaiver(
  db: DbClient,
  task: Task,
  stageId: string,
  assessment: HarnessCoverageAssessment,
): Promise<boolean> {
  const waiver = await coverageWaiverInForce(db, task.repoUrl)
  if (!waiver) return false

  await db
    .update(tasks)
    .set({ harnessStatus: 'waived', updatedAt: new Date() })
    .where(eq(tasks.id, task.id))

  // The second probing stage of the same task inherits the same acceptance;
  // one resolved record is the whole point, so a repeat writes nothing.
  //
  // Only a *resolved* record counts as that repeat. An open card is the
  // owner's unanswered question about this same gap — letting it stand in for
  // the record would skip both the inheritance decision and its event, and the
  // caller would then close the owner's card as though something had been
  // reclassified (AC-1423).
  const [existing] = await db
    .select({ id: decisions.id })
    .from(decisions)
    .where(
      and(
        eq(decisions.taskId, task.id),
        eq(decisions.nodeKey, COVERAGE_DECISION_NODE_KEY),
        eq(decisions.key, COVERAGE_DECISION_KEY),
        ne(decisions.status, 'open'),
      ),
    )
    .limit(1)
  if (existing) return true

  const origin = waiver.originTaskId
    ? await db
        .select({ title: tasks.title })
        .from(tasks)
        .where(eq(tasks.id, waiver.originTaskId))
        .limit(1)
    : []
  const from = origin[0]?.title ?? 'an earlier task'

  await db.insert(decisions).values({
    taskId: task.id,
    stageId,
    nodeKey: COVERAGE_DECISION_NODE_KEY,
    key: COVERAGE_DECISION_KEY,
    kind: 'question',
    promptMd: renderInheritedWaiverPrompt(assessment, from),
    options: [],
    blocking: false,
    status: 'answered',
    answeredBy: 'system',
    answerMd: `Inherited: this repository's coverage gap was accepted on "${from}".`,
    answeredAt: new Date(),
  })

  await emitEvent(db, {
    taskId: task.id,
    stageId,
    type: 'decision.inherited',
    payload: { waiverId: waiver.id, originTaskId: waiver.originTaskId },
  })

  return true
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
 * REQ-1406: the acceptance in force for a repository, or null when the owner
 * has not accepted its gap (or has taken the acceptance back).
 */
export async function coverageWaiverInForce(
  db: DbClient,
  repoUrl: string,
): Promise<CoverageWaiver | null> {
  const [waiver] = await db
    .select()
    .from(coverageWaivers)
    .where(and(eq(coverageWaivers.repoUrl, repoUrl), isNull(coverageWaivers.revokedAt)))
    .limit(1)

  return waiver ?? null
}

/**
 * AC-1427: the partial unique index is what makes "one in force" true, so a
 * second acceptance defers to the one already there rather than racing it.
 * The first acceptance is the one that names the task it came from.
 */
export async function recordCoverageWaiver(
  db: DbClient,
  input: { repoUrl: string; originTaskId?: string },
): Promise<CoverageWaiver | null> {
  const [waiver] = await db
    .insert(coverageWaivers)
    .values({ repoUrl: input.repoUrl, originTaskId: input.originTaskId ?? null })
    .onConflictDoNothing()
    .returning()

  return waiver ?? null
}

/**
 * Revoking marks the waiver; what was accepted and when it ended both stay
 * readable. Addressed by repository rather than by record id — at most one is
 * ever in force, so the repository is the whole identity a caller needs.
 */
export async function revokeCoverageWaiverInForce(
  db: DbClient,
  repoUrl: string,
): Promise<CoverageWaiver | null> {
  const [revoked] = await db
    .update(coverageWaivers)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(coverageWaivers.repoUrl, repoUrl), isNull(coverageWaivers.revokedAt)))
    .returning()

  return revoked ?? null
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

/**
 * The plan behind the task's declared size, read back the same way and for the
 * same reason: the prerequisites the owner is choosing about live in the
 * planning stage's own result, so the decision card and the tasks it creates
 * come from one source rather than from a prompt and a copy of it.
 */
export async function latestPlanShape(db: DbClient, taskId: string): Promise<PlanShape | null> {
  const [row] = await db
    .select({ result: stages.result })
    .from(stages)
    .where(and(eq(stages.taskId, taskId), sql`${stages.result} ->> 'plan' is not null`))
    .orderBy(desc(stages.finishedAt))
    .limit(1)

  return row?.result?.plan ?? null
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
