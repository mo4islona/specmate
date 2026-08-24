import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
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

  // The fake the engine was built with, so a test can read what it was asked to do.
  const engineWorkspaces = new WeakMap<Engine, ReturnType<typeof fakeWorkspaces>>()

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
    engineWorkspaces.set(engine, ws)

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

  it('a small plan appends the compact graph and drops the spec review — AC-417', async () => {
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

  it('planning renames the task and leaves its slug alone — AC-1320, AC-343', async () => {
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

  it('names the change folder from the plan, before the stage commits — AC-741, AC-1323', async () => {
    const { engine, stagesDispatcher } = makeEngine()
    const ws = engineWorkspaces.get(engine)
    const { task } = await seed({ at: 'planning' })
    stagesDispatcher.plan(() => ({
      ...planningResult('medium', { change: 'pie-chart-axis-fade' }),
      commitDeferred: true,
    }))

    await engine.tick()
    await engine.idle()

    expect((await reload(db, task.id)).changeName).toBe('pie-chart-axis-fade')
    expect(ws?.calls.changeFolderRenames).toEqual([
      { slug: task.slug, changeName: 'pie-chart-axis-fade' },
    ])
    // The commit that follows sees the renamed folder, so the first commit of
    // the task's history carries no path under the provisional name.
    expect(ws?.calls.stageCommits.map((commit) => commit.changeDir)).toEqual([
      'openspec/changes/pie-chart-axis-fade',
    ])
  })

  it('cuts the change folder from the title when the plan named none — AC-1324', async () => {
    const { engine, stagesDispatcher } = makeEngine()
    const { task } = await seed({ at: 'planning' })
    stagesDispatcher.plan(() =>
      planningResult('medium', { title: 'Recover ingestion from a stale lease' }),
    )

    await engine.tick()
    await engine.idle()

    expect((await reload(db, task.id)).changeName).toBe('recover-ingestion-from-a-stale-lease')
  })

  it('leaves the folder under the slug for a role that declares no plan — AC-740', async () => {
    const { engine, stagesDispatcher } = makeEngine()
    const ws = engineWorkspaces.get(engine)
    const { task } = await seed({ at: 'implement' })
    stagesDispatcher.plan(() => ({
      status: 'succeeded' as const,
      attempts: [{ attempt: 0, ok: true, durationMs: 5 }],
      result: StageResult.parse({
        schema_version: 1,
        role: 'implementer',
        status: 'ok',
        notes_md: 'stub',
        plan: planShape({ change: 'not-this-role-s-to-name' }),
      }),
      telemetry: { model: 'stub-model-1', tokens: null, costUsd: null, raw: null },
    }))

    await engine.tick()
    await engine.idle()

    expect((await reload(db, task.id)).changeName).toBeNull()
    expect(ws?.calls.changeFolderRenames).toEqual([])
  })

  it('a plan repeating the title the task already has renames nothing', async () => {
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

  it('a medium plan appends nothing and walks the graph it has — AC-418', async () => {
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

  it('the stages run before the swap stay readable beside the version they ran under — AC-419', async () => {
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

  it('a compact task dispatches the specification straight from the kickoff gate', async () => {
    const { engine, stagesDispatcher } = makeEngine()
    const { task } = await seed({ at: 'planning' })
    stagesDispatcher.plan(() => planningResult('small'))
    await engine.tick()
    await engine.idle()

    await engine.approve(task.id, 'evgeny')

    expect((await reload(db, task.id)).status).toBe('specify')
  })

  it('AC-427: the declared size records its caps on the task', async () => {
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

  it('AC-428: medium and large share a profile and are separated by their caps', async () => {
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

  it('AC-641: a cap the owner chose survives the size the planner declares', async () => {
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
