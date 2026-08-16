import {
  Budgets,
  Caps,
  instantiateDefinition,
  nodeAt,
  PIPELINE_CATALOG,
  type PinnedGraph,
  type RecordedRound,
  type RoundToRecord,
  type TaskState,
  type TaskType,
} from '@specmate/core'
import {
  type Database,
  type DbClient,
  events,
  iterations,
  runGraphs,
  type Task,
  tasks,
} from '@specmate/db'
import { asc, desc, eq, sql } from 'drizzle-orm'

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

export interface CreateTaskInput {
  readonly slug: string
  readonly title: string
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

  const [latest] = await db
    .select({ version: runGraphs.version })
    .from(runGraphs)
    .where(eq(runGraphs.taskId, taskId))
    .orderBy(desc(runGraphs.version))
    .limit(1)
  const [graph] = await db
    .insert(runGraphs)
    .values({ taskId, version: (latest?.version ?? 0) + 1, dag: instantiateDefinition(definition) })
    .returning()
  if (!graph) throw new Error(`run graph v${(latest?.version ?? 0) + 1} could not be created`)

  return graph
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

export async function countRedirects(db: DbClient, taskId: string, gate: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(events)
    .where(
      sql`${events.taskId} = ${taskId} and ${events.type} = 'gate.redirected' and ${events.payload}->>'gate' = ${gate}`,
    )

  return row?.n ?? 0
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
