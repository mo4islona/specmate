import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createDb, type Database, iterations, tasks } from '@specmate/db'
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
})
