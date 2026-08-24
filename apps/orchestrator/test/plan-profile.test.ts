import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'
import {
  CAPS_FOR_SIZE,
  FEATURE_BUGFIX_COMPACT,
  FEATURE_BUGFIX_PIPELINE,
  type PlanShape,
  StageResult,
} from '@specmate/core'
import { createDb, type Database, events, runGraphs, stages, tasks } from '@specmate/db'
import type { StageExecution } from '@specmate/runner'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { Engine, type EngineSettings } from '../src/engine.ts'
import { fakeDispatcher, fakeWorkspaces, planShape, reload, seedTask } from './fixtures.ts'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

const ADEQUATE = { classification: 'adequate' as const, evidence_md: 'An e2e suite covers it.' }

function planningResult(
  size: 'small' | 'medium' | 'large',
  overrides: Partial<PlanShape> = {},
): StageExecution {
  return {
    status: 'succeeded',
    attempts: [{ attempt: 0, ok: true, durationMs: 5 }],
    result: StageResult.parse({
      schema_version: 1,
      role: 'planner',
      status: 'ok',
      harness_coverage: ADEQUATE,
      plan: planShape({ size, ...overrides }),
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

  // Ten connections handed back. A suite that keeps its pool is a suite the
  // ones after it pay for, against a server that allows a hundred in total.
  afterAll(async () => {
    await db.$client.close()
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

  test('a small plan appends the compact graph and drops the spec review — AC-417', async () => {
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
    expect(versions[1]?.dag.nodes.map((node) => node.key)).not.toContain('spec_review')
  })

  test('planning renames the task and leaves its slug alone — AC-1320, AC-343', async () => {
    const { engine, stagesDispatcher } = makeEngine()
    const { task } = await seed({ at: 'planning' })
    stagesDispatcher.plan(() =>
      planningResult('medium', { title: 'Recover ingestion from a stale lease', type: 'bugfix' }),
    )

    await engine.tick()
    await engine.idle()

    const after = await reload(db, task.id)
    expect(after.title).toBe('Recover ingestion from a stale lease')
    expect(after.type).toBe('bugfix')
    expect(after.slug).toBe(task.slug)

    const renames = await db
      .select()
      .from(events)
      .where(and(eq(events.taskId, task.id), eq(events.type, 'task.renamed')))
    expect(renames).toHaveLength(1)
    expect(renames[0]?.payload).toMatchObject({
      from: task.title,
      title: 'Recover ingestion from a stale lease',
      type: 'bugfix',
    })
  })

  test('a plan repeating the title the task already has renames nothing', async () => {
    const { engine, stagesDispatcher } = makeEngine()
    const { task } = await seed({ at: 'planning' })
    stagesDispatcher.plan(() => planningResult('medium', { title: task.title, type: task.type }))

    await engine.tick()
    await engine.idle()

    const renames = await db
      .select()
      .from(events)
      .where(and(eq(events.taskId, task.id), eq(events.type, 'task.renamed')))
    expect(renames).toHaveLength(0)
  })

  test('a medium plan appends nothing and walks the graph it has — AC-418', async () => {
    const { engine, stagesDispatcher } = makeEngine()
    const { task } = await seed({ at: 'planning' })
    stagesDispatcher.plan(() => planningResult('medium'))

    await engine.tick()
    await engine.idle()

    const after = await reload(db, task.id)
    expect(after.planSize).toBe('medium')
    expect(after.status).toBe('human_kickoff_gate')
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

  test('a compact task dispatches the specification straight from the kickoff gate', async () => {
    const { engine, stagesDispatcher } = makeEngine()
    const { task } = await seed({ at: 'planning' })
    stagesDispatcher.plan(() => planningResult('small'))
    await engine.tick()
    await engine.idle()

    await engine.approve(task.id, 'evgeny')

    expect((await reload(db, task.id)).status).toBe('specify')
  })

  test('AC-427: the declared size records its caps on the task', async () => {
    const { engine, stagesDispatcher } = makeEngine()
    const { task } = await seed({ at: 'planning' })
    stagesDispatcher.plan(() => planningResult('small'))

    await engine.tick()
    await engine.idle()

    expect((await reload(db, task.id)).caps).toMatchObject({
      max_spec_iterations: CAPS_FOR_SIZE.small.max_spec_iterations,
      max_impl_iterations: CAPS_FOR_SIZE.small.max_impl_iterations,
    })
  })

  test('AC-428: medium and large share a profile and are separated by their caps', async () => {
    const runs: Record<'medium' | 'large', number | undefined> = {
      medium: undefined,
      large: undefined,
    }
    for (const size of ['medium', 'large'] as const) {
      const { engine, stagesDispatcher } = makeEngine()
      const { task } = await seed({ at: 'planning' })
      stagesDispatcher.plan(() => planningResult(size))

      await engine.tick()
      await engine.idle()

      const after = await reload(db, task.id)
      expect(await graphVersions(task.id)).toHaveLength(1)
      runs[size] = after.caps.max_impl_iterations
    }

    expect(runs.medium).not.toBe(runs.large)
  })

  test('AC-641: a cap the owner chose survives the size the planner declares', async () => {
    const { engine, stagesDispatcher } = makeEngine()
    const { task } = await seed({ at: 'planning', caps: { max_impl_iterations: 9 } })
    stagesDispatcher.plan(() => planningResult('small'))

    await engine.tick()
    await engine.idle()

    const after = await reload(db, task.id)
    // Everything the profile sets, except the one cap the owner had already chosen.
    expect(after.caps).toMatchObject({ ...CAPS_FOR_SIZE.small, max_impl_iterations: 9 })
  })
})
