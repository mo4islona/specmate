import { beforeAll, describe, expect, test } from 'bun:test'
import { createDb, type Database, stages, tasks } from '@specmate/db'
import { and, eq, inArray } from 'drizzle-orm'
import { Engine } from '../src/engine.ts'
import {
  fakeDispatcher,
  fakeWorkspaces,
  okExecution,
  planShape,
  reload,
  seedTask,
} from './fixtures.ts'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

describeDb('a node that resumes an earlier session', () => {
  let db: Database
  const created: string[] = []
  const engines: Engine[] = []

  beforeAll(() => {
    db = createDb(url)
  })

  async function cleanup() {
    for (const engine of engines.splice(0)) await engine.idle()
    if (created.length > 0) await db.delete(tasks).where(inArray(tasks.id, created.splice(0)))
  }

  /** A fresh Engine over the same store is what a restart looks like from here. */
  function makeEngine() {
    const stagesDispatcher = fakeDispatcher()
    const engine = new Engine({
      db,
      workspaces: fakeWorkspaces().workspaces,
      settings: { stageConcurrency: 2, stageAttemptCap: 2, availableProviders: ['claude-code'] },
      dispatcher: stagesDispatcher.dispatcher,
      log: () => {},
    })
    engines.push(engine)

    return { engine, stagesDispatcher }
  }

  async function planningLeavesSession(sessionId: string | null) {
    const seeded = await seedTask(db, { at: 'planning' })
    created.push(seeded.task.id)

    const { engine, stagesDispatcher } = makeEngine()
    stagesDispatcher.plan(() => ({
      ...okExecution('planner'),
      result: {
        ...okExecution('planner').result,
        harness_coverage: {
          classification: 'adequate' as const,
          evidence_md: 'An e2e suite covers it.',
        },
        plan: planShape(),
      },
      sessionId,
    }))
    await engine.tick()
    await engine.idle()

    return seeded.task
  }

  test('AC-232: the session the run left is recorded on its stage', async () => {
    const task = await planningLeavesSession('sess-planning')

    const [row] = await db
      .select()
      .from(stages)
      .where(and(eq(stages.taskId, task.id), eq(stages.nodeKey, 'planning')))
    expect(row?.providerSessionId).toBe('sess-planning')
    await cleanup()
  })

  test('AC-233, AC-234: the specification continues it, across the gate and a restart', async () => {
    const task = await planningLeavesSession('sess-planning')
    expect((await reload(db, task.id)).status).toBe('human_kickoff_gate')

    // A second Engine over the same store: nothing was held in memory across the gate.
    const { engine: restarted, stagesDispatcher } = makeEngine()
    await restarted.approve(task.id, 'evgeny')
    stagesDispatcher.plan(() => okExecution('planner'))
    await restarted.tick()
    await restarted.idle()

    expect(stagesDispatcher.dispatches[0]).toMatchObject({
      node: { key: 'specify' },
      resume: { node: 'planning', sessionId: 'sess-planning' },
    })
    await cleanup()
  })

  test('AC-235: a continuation whose session was never recorded still continues', async () => {
    const task = await planningLeavesSession(null)

    const { engine: restarted, stagesDispatcher } = makeEngine()
    await restarted.approve(task.id, 'evgeny')
    stagesDispatcher.plan(() => okExecution('planner'))
    await restarted.tick()
    await restarted.idle()

    // The node, not the session, is what makes the run a continuation: losing the
    // session starts it cold, and must not put a first pass's obligations back on it.
    expect(stagesDispatcher.dispatches[0]).toMatchObject({
      node: { key: 'specify' },
      resume: { node: 'planning', sessionId: null },
    })
    await cleanup()
  })

  test('a node that declares no resumption is dispatched without one', async () => {
    const seeded = await seedTask(db, { at: 'implement' })
    created.push(seeded.task.id)
    const { engine, stagesDispatcher } = makeEngine()
    stagesDispatcher.plan(() => okExecution('implementer'))

    await engine.tick()
    await engine.idle()

    expect(stagesDispatcher.dispatches[0]?.resume).toBeNull()
    await cleanup()
  })
})
