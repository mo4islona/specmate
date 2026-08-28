import { afterAll, beforeAll, describe, expect, it, test } from 'bun:test'
import type { PinnedGraph } from '@specmate/core'
import {
  createDb,
  type Database,
  feedback,
  findOrCreateRepository,
  iterations,
  runGraphs,
  stages,
  tasks,
} from '@specmate/db'
import { mirrorKey } from '@specmate/workspace'
import { and, eq } from 'drizzle-orm'
import { loadLedgerSnapshot, TaskNotFoundError } from '../src/ledger.ts'

/** The rows under test do not read the graph; it only has to be one. */
const EMPTY_DAG = {
  pipeline: 'feature-bugfix',
  entry: 'planning',
  terminal: 'archived',
  nodes: [],
} satisfies PinnedGraph

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

describeDb('ledger snapshot', () => {
  let db: Database
  let taskId: string

  beforeAll(async () => {
    db = createDb(url)
    const [task] = await db
      .insert(tasks)
      .values({
        slug: `ledger-${crypto.randomUUID().slice(0, 8)}`,
        title: 'Ledger fixture',
        type: 'bugfix',
        repoUrl: 'file:///tmp/ledger-fixture',
        repositoryId: (
          await findOrCreateRepository(db, {
            repoUrl: 'file:///tmp/ledger-fixture',
            mirrorKey: mirrorKey('file:///tmp/ledger-fixture'),
          })
        ).id,
        baseBranch: 'main',
        status: 'spec_review',
      })
      .returning()
    taskId = task?.id ?? ''
    await db.insert(iterations).values({
      taskId,
      loop: 'spec',
      round: 1,
      reviewerVerdict: 'revise',
      findings: [
        { id: 'no-scenario', severity: 'blocking', title: 'Missing scenario', detail_md: '' },
      ],
    })
  })

  afterAll(async () => {
    if (taskId) await db.delete(tasks).where(eq(tasks.id, taskId))

    // Last, and unconditional: the cleanup above needs the connection, and
    // the next suite needs it back.
    await db.$client.close()
  })

  test('reads the task and its rounds', async () => {
    const snapshot = await loadLedgerSnapshot(db, taskId)

    expect(snapshot.title).toBe('Ledger fixture')
    expect(snapshot.status).toBe('spec_review')
    expect(snapshot.caps.max_spec_iterations).toBeGreaterThan(0)
    expect(snapshot.rounds).toHaveLength(1)
    expect(snapshot.rounds[0]?.findings[0]?.id).toBe('no-scenario')
  })

  it('AC-248: carries the rejection of the last attempt at the node the task stands on', async () => {
    // Version 2: a task has one graph per version, and the suite's other case
    // takes the first.
    const [graph] = await db
      .insert(runGraphs)
      .values({ taskId, version: 2, dag: EMPTY_DAG })
      .returning()
    const rejected = {
      taskId,
      graphId: graph?.id ?? '',
      nodeKey: 'spec_review',
      role: 'reviewer',
      provider: 'claude-code',
    } as const
    await db.insert(stages).values({
      ...rejected,
      status: 'failed',
      attempt: 0,
      cost: { failure: { reason: 'scope_violation', detail: 'changed src/app.ts' } },
    })

    const carried = await loadLedgerSnapshot(db, taskId)
    expect(carried.lastRejection).toEqual({
      attempt: 0,
      reason: 'scope_violation',
      detail: 'changed src/app.ts',
      workspaceReset: true,
    })

    // The shape a re-dispatch is actually read in: `claim()` inserts this
    // attempt's own row before the dispatcher renders anything, so a snapshot
    // that let a running row answer would find one that has not failed yet and
    // report no rejection at all — on every dispatch after the first.
    await db.insert(stages).values({ ...rejected, status: 'running', attempt: 1 })
    const redispatched = await loadLedgerSnapshot(db, taskId)

    expect(redispatched.lastRejection).toMatchObject({ attempt: 0, reason: 'scope_violation' })

    // A conversation turn is not an attempt at this node and has no rejection
    // of its own to answer.
    const conversation = await loadLedgerSnapshot(db, taskId, 'conversation')

    expect(conversation.lastRejection).toBeNull()

    // An attempt the harness accepted answers the rejection before it: the next
    // run at this node is repeating nothing.
    await db
      .update(stages)
      .set({ status: 'succeeded', cost: {} })
      .where(
        and(eq(stages.taskId, taskId), eq(stages.nodeKey, 'spec_review'), eq(stages.attempt, 1)),
      )
    const answered = await loadLedgerSnapshot(db, taskId)

    expect(answered.lastRejection).toBeNull()
  })

  it('REQ-217: reads the graph the task runs now, and only reasons the table carries', async () => {
    // Attempts are numbered per graph, so a replan restarts this node at 0 while
    // the superseded graph still holds its attempt 1. Ordering by attempt across
    // both would answer for a pipeline that no longer exists.
    const [graph] = await db
      .insert(runGraphs)
      .values({ taskId, version: 3, dag: EMPTY_DAG })
      .returning()
    const replanned = {
      taskId,
      graphId: graph?.id ?? '',
      nodeKey: 'spec_review',
      role: 'reviewer',
      provider: 'claude-code',
      status: 'failed',
      attempt: 0,
    } as const
    await db.insert(stages).values({
      ...replanned,
      cost: { failure: { reason: 'agent_failed', detail: 'could not find the spec suite' } },
    })

    const scoped = await loadLedgerSnapshot(db, taskId)

    expect(scoped.lastRejection).toMatchObject({ attempt: 0, reason: 'agent_failed' })

    // `settleOrphan` writes this after a restart. It is not a member of the
    // vocabulary and nothing about it is an agent's to correct.
    await db
      .update(stages)
      .set({ cost: { failure: { reason: 'orphaned' } } })
      .where(and(eq(stages.graphId, graph?.id ?? ''), eq(stages.nodeKey, 'spec_review')))
    const engineEnum = await loadLedgerSnapshot(db, taskId)

    expect(engineEnum.lastRejection).toBeNull()
  })

  test('names a task that does not exist', async () => {
    const missing = loadLedgerSnapshot(db, '00000000-0000-4000-8000-000000000000')

    await expect(missing).rejects.toThrow(TaskNotFoundError)
  })

  test('renders guidance only while the run that claimed it is still going', async () => {
    const [graph] = await db.insert(runGraphs).values({ taskId, dag: EMPTY_DAG }).returning()
    const [running] = await db
      .insert(stages)
      .values({
        taskId,
        graphId: graph?.id ?? '',
        nodeKey: 'implement',
        role: 'implementer',
        provider: 'claude-code',
        status: 'running',
        attempt: 0,
      })
      .returning()
    const [guidance] = await db
      .insert(feedback)
      .values({
        taskId,
        kind: 'intervention',
        textMd: 'Keep the migration reversible.',
        target: { nodeKey: 'implement' },
        consumedByStageId: running?.id,
      })
      .returning()

    const claimed = await loadLedgerSnapshot(db, taskId)
    expect(claimed.interventions.map((entry) => entry.instruction)).toEqual([
      'Keep the migration reversible.',
    ])

    // The run fails and the engine releases the claim (AC-129): the guidance is
    // pending again, and the next attempt claims and renders it.
    await db
      .update(stages)
      .set({ status: 'failed' })
      .where(eq(stages.id, running?.id ?? ''))
    await db
      .update(feedback)
      .set({ consumedByStageId: null })
      .where(eq(feedback.id, guidance?.id ?? ''))
    const released = await loadLedgerSnapshot(db, taskId)
    expect(released.interventions).toEqual([])

    const [retry] = await db
      .insert(stages)
      .values({
        taskId,
        graphId: graph?.id ?? '',
        nodeKey: 'implement',
        role: 'implementer',
        provider: 'claude-code',
        status: 'running',
        attempt: 1,
      })
      .returning()
    await db
      .update(feedback)
      .set({ consumedByStageId: retry?.id })
      .where(eq(feedback.id, guidance?.id ?? ''))
    const reclaimed = await loadLedgerSnapshot(db, taskId)
    expect(reclaimed.interventions).toHaveLength(1)

    await db.delete(feedback).where(eq(feedback.id, guidance?.id ?? ''))
  })

  test('loads a gate comment with the gate it was left at', async () => {
    await db.insert(feedback).values({
      taskId,
      kind: 'redirect',
      textMd: 'The approach misses the auth edge case.',
      target: { nodeKey: 'human_kickoff_gate' },
    })

    const snapshot = await loadLedgerSnapshot(db, taskId)

    expect(snapshot.gateComments).toEqual([
      {
        nodeKey: 'human_kickoff_gate',
        kind: 'redirect',
        comment: 'The approach misses the auth edge case.',
      },
    ])
  })
})
