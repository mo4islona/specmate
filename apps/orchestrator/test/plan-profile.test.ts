import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'
import { FEATURE_BUGFIX_COMPACT, FEATURE_BUGFIX_PIPELINE, StageResult } from '@specmate/core'
import { createDb, type Database, runGraphs, stages, tasks } from '@specmate/db'
import type { StageExecution } from '@specmate/runner'
import { asc, eq, inArray } from 'drizzle-orm'
import { Engine, type EngineSettings } from '../src/engine.ts'
import { fakeDispatcher, fakeWorkspaces, reload, seedTask } from './fixtures.ts'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

const ADEQUATE = { classification: 'adequate' as const, evidence_md: 'An e2e suite covers it.' }

function planningResult(size: 'small' | 'medium' | 'large'): StageExecution {
  return {
    status: 'succeeded',
    attempts: [{ attempt: 0, ok: true, durationMs: 5 }],
    result: StageResult.parse({
      schema_version: 1,
      role: 'planner',
      status: 'ok',
      harness_coverage: ADEQUATE,
      plan: { size, prerequisites: [] },
    }),
    telemetry: { model: 'stub-model-1', tokens: null, costUsd: null, raw: null },
  }
}

describeDb('the profile a declared size selects', () => {
  let db: Database
  const created: string[] = []
  const engines: Engine[] = []

  beforeAll(() => {
    db = createDb(url)
  })

  afterEach(async () => {
    for (const engine of engines.splice(0)) await engine.idle()
    if (created.length > 0) await db.delete(tasks).where(inArray(tasks.id, created.splice(0)))
  })

  function makeEngine(overrides: Partial<EngineSettings> = {}) {
    const ws = fakeWorkspaces()
    const stagesDispatcher = fakeDispatcher()
    const engine = new Engine({
      db,
      workspaces: ws.workspaces,
      settings: {
        stageConcurrency: 2,
        stageAttemptCap: 2,
        availableProviders: ['claude-code'],
        ...overrides,
      },
      dispatcher: stagesDispatcher.dispatcher,
      log: () => {},
    })
    engines.push(engine)

    return { engine, stagesDispatcher }
  }

  async function seed(options: Parameters<typeof seedTask>[1] = {}) {
    const seeded = await seedTask(db, options)
    created.push(seeded.task.id)

    return seeded
  }

  async function graphVersions(taskId: string) {
    return db
      .select()
      .from(runGraphs)
      .where(eq(runGraphs.taskId, taskId))
      .orderBy(asc(runGraphs.version))
  }

  test('a small plan appends the compact graph and skips the second planner pass — AC-417', async () => {
    const { engine, stagesDispatcher } = makeEngine()
    const { task } = await seed({ at: 'planning' })
    stagesDispatcher.plan(() => planningResult('small'))

    await engine.tick()
    await engine.idle()

    const after = await reload(db, task.id)
    expect(after.planSize).toBe('small')
    expect(after.status).toBe('human_kickoff_gate')

    const versions = await graphVersions(task.id)
    expect(versions).toHaveLength(2)
    expect(versions[0]?.dag.pipeline).toBe(FEATURE_BUGFIX_PIPELINE.id)
    expect(versions[1]?.dag.pipeline).toBe(FEATURE_BUGFIX_COMPACT.id)
    expect(versions[1]?.dag.nodes.map((node) => node.key)).not.toContain('kickoff_brief')
  })

  test('a medium plan appends nothing and walks the graph it has — AC-418', async () => {
    const { engine, stagesDispatcher } = makeEngine()
    const { task } = await seed({ at: 'planning' })
    stagesDispatcher.plan(() => planningResult('medium'))

    await engine.tick()
    await engine.idle()

    const after = await reload(db, task.id)
    expect(after.planSize).toBe('medium')
    expect(after.status).toBe('kickoff_brief')
    expect(await graphVersions(task.id)).toHaveLength(1)
  })

  test('the stages run before the swap stay readable beside the version they ran under — AC-419', async () => {
    const { engine, stagesDispatcher } = makeEngine()
    const { task } = await seed({ at: 'planning' })
    stagesDispatcher.plan(() => planningResult('small'))

    await engine.tick()
    await engine.idle()

    const versions = await graphVersions(task.id)
    const first = versions[0]
    assert(first)
    const before = await db.select().from(stages).where(eq(stages.graphId, first.id))
    expect(before.map((row) => row.nodeKey)).toEqual(['planning'])
    expect(before[0]?.status).toBe('succeeded')
  })

  test('a compact task dispatches research straight from the kickoff gate', async () => {
    const { engine, stagesDispatcher } = makeEngine()
    const { task } = await seed({ at: 'planning' })
    stagesDispatcher.plan(() => planningResult('small'))
    await engine.tick()
    await engine.idle()

    await engine.approve(task.id, 'evgeny')

    expect((await reload(db, task.id)).status).toBe('research')
  })

  test('a size declared at the second planner pass does not strand the task on a dropped node', async () => {
    const { engine, stagesDispatcher } = makeEngine()
    const { task } = await seed({ at: 'kickoff_brief' })
    stagesDispatcher.plan(() => planningResult('small'))

    await engine.tick()
    await engine.idle()

    const after = await reload(db, task.id)
    expect(after.status).toBe('human_kickoff_gate')
    expect(await graphVersions(task.id)).toHaveLength(1)
  })
})
