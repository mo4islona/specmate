import { beforeAll, describe, expect, test } from 'bun:test'
import { SPEC_REVIEW_SCENARIO_FLOOR } from '@specmate/core'
import { createDb, type Database, events, stages, tasks } from '@specmate/db'
import { asc, eq, inArray } from 'drizzle-orm'
import { Engine } from '../src/engine.ts'
import { fakeDispatcher, fakeWorkspaces, okExecution, reload, seedTask } from './fixtures.ts'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

describeDb('a conditional node', () => {
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

  function makeEngine(scenarios?: number) {
    const ws = fakeWorkspaces()
    if (scenarios !== undefined) ws.declareSpecScenarios(scenarios)
    const stagesDispatcher = fakeDispatcher()
    const engine = new Engine({
      db,
      workspaces: ws.workspaces,
      settings: { stageConcurrency: 2, stageAttemptCap: 2, availableProviders: ['claude-code'] },
      dispatcher: stagesDispatcher.dispatcher,
      log: () => {},
    })
    engines.push(engine)

    return { engine, stagesDispatcher }
  }

  async function seed(at: string) {
    const seeded = await seedTask(db, { at: at as never })
    created.push(seeded.task.id)

    return seeded
  }

  test('AC-421: a spec under the floor skips the review and advances', async () => {
    const { engine, stagesDispatcher } = makeEngine(SPEC_REVIEW_SCENARIO_FLOOR - 1)
    const { task } = await seed('spec_review')

    await engine.tick()
    await engine.idle()

    expect((await reload(db, task.id)).status).toBe('human_spec_gate')
    expect(stagesDispatcher.dispatches).toHaveLength(0)
    await cleanup()
  })

  test('AC-422: the skipped node stays in the record, carrying its reason', async () => {
    const { engine } = makeEngine(1)
    const { task } = await seed('spec_review')

    await engine.tick()
    await engine.idle()

    const [row] = await db.select().from(stages).where(eq(stages.taskId, task.id))
    expect(row).toMatchObject({ nodeKey: 'spec_review', status: 'skipped' })
    expect(row?.skipReason).toContain('1 scenario')

    const types = await db
      .select({ type: events.type })
      .from(events)
      .where(eq(events.taskId, task.id))
      .orderBy(asc(events.seq))
    expect(types.map((t) => t.type)).toContain('stage.skipped')
    await cleanup()
  })

  test('a spec at the floor runs the review like any other node', async () => {
    const { engine, stagesDispatcher } = makeEngine(SPEC_REVIEW_SCENARIO_FLOOR)
    const { task } = await seed('spec_review')
    stagesDispatcher.plan(() => okExecution('reviewer', { verdict: 'approve' }))

    await engine.tick()
    await engine.idle()

    expect(stagesDispatcher.dispatches).toHaveLength(1)
    expect((await reload(db, task.id)).status).toBe('human_spec_gate')
    await cleanup()
  })

  test('a fact that cannot be had runs the node rather than skipping it', async () => {
    // Never skip a check you could not justify skipping.
    const { engine, stagesDispatcher } = makeEngine()
    const { task } = await seed('spec_review')
    stagesDispatcher.plan(() => okExecution('reviewer', { verdict: 'approve' }))

    await engine.tick()
    await engine.idle()

    expect(stagesDispatcher.dispatches).toHaveLength(1)
    expect((await reload(db, task.id)).status).toBe('human_spec_gate')
    await cleanup()
  })
})
