import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  createDb,
  type Database,
  feedback,
  iterations,
  runGraphs,
  stages,
  tasks,
} from '@specmate/db'
import { eq } from 'drizzle-orm'
import { loadLedgerSnapshot, TaskNotFoundError } from '../src/ledger.ts'

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
  })

  test('reads the task and its rounds', async () => {
    const snapshot = await loadLedgerSnapshot(db, taskId)

    expect(snapshot.title).toBe('Ledger fixture')
    expect(snapshot.status).toBe('spec_review')
    expect(snapshot.caps.max_spec_iterations).toBeGreaterThan(0)
    expect(snapshot.rounds).toHaveLength(1)
    expect(snapshot.rounds[0]?.findings[0]?.id).toBe('no-scenario')
  })

  test('names a task that does not exist', async () => {
    const missing = loadLedgerSnapshot(db, '00000000-0000-4000-8000-000000000000')

    await expect(missing).rejects.toThrow(TaskNotFoundError)
  })

  test('renders guidance only while the run that claimed it is still going', async () => {
    const [graph] = await db
      .insert(runGraphs)
      .values({ taskId, dag: { nodes: [] } })
      .returning()
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
