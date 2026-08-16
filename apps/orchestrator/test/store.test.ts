import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { FEATURE_BUGFIX_PIPELINE, instantiateDefinition } from '@specmate/core'
import { createDb, type Database, events, iterations, runGraphs, stages, tasks } from '@specmate/db'
import { asc, eq, inArray } from 'drizzle-orm'
import {
  createTask,
  latestGraph,
  recordRound,
  replanTask,
  UnknownNodeError,
  UnknownTaskTypeError,
} from '../src/store.ts'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

describeDb('task store', () => {
  let db: Database
  const created: string[] = []

  beforeAll(() => {
    db = createDb(url)
  })

  afterAll(async () => {
    if (created.length > 0) await db.delete(tasks).where(inArray(tasks.id, created))
  })

  async function make(at?: 'research') {
    const slug = `store-${crypto.randomUUID().slice(0, 8)}`
    const seeded = await createTask(db, {
      slug,
      title: `Fixture ${slug}`,
      type: 'feature',
      repoUrl: 'file:///dev/null',
      at,
    })
    created.push(seeded.task.id)

    return seeded
  }

  test('creating a task pins its type’s definition into the run graph', async () => {
    const { task, graph } = await make()

    expect(task.status).toBe('draft')
    expect(graph.version).toBe(1)
    expect(graph.dag).toEqual(instantiateDefinition(FEATURE_BUGFIX_PIPELINE))
    expect(task.caps.max_spec_iterations).toBe(3)
    expect(task.budgets.max_cost_usd).toBe(20)
    const createdEvents = await db.select().from(events).where(eq(events.taskId, task.id))
    expect(createdEvents).toHaveLength(1)
    expect(createdEvents[0]).toMatchObject({ type: 'task.created', payload: { title: task.title } })
  })

  test('an uncataloged type is rejected naming the type', async () => {
    const attempt = createTask(db, {
      slug: 'never',
      title: 'never',
      type: 'incident',
      repoUrl: 'file:///dev/null',
    })

    await expect(attempt).rejects.toThrow(UnknownTaskTypeError)
    await expect(attempt).rejects.toThrow(/"incident"/)
  })

  test('dev creation positions the task at a named stage node, and only a stage node', async () => {
    const { task } = await make('research')

    expect(task.status).toBe('research')
    await expect(
      createTask(db, {
        slug: 'never-gate',
        title: 'never',
        type: 'feature',
        repoUrl: 'file:///dev/null',
        at: 'human_spec_gate',
      }),
    ).rejects.toThrow(UnknownNodeError)
  })

  test('re-planning appends a version and leaves the prior one readable', async () => {
    const { task, graph } = await make('research')
    await db.insert(stages).values({
      taskId: task.id,
      graphId: graph.id,
      nodeKey: 'research',
      role: 'researcher',
      provider: 'claude-code',
      status: 'succeeded',
      attempt: 0,
    })

    const next = await replanTask(db, task.id)

    expect(next.version).toBe(2)
    const versions = await db
      .select()
      .from(runGraphs)
      .where(eq(runGraphs.taskId, task.id))
      .orderBy(asc(runGraphs.version))
    expect(versions).toHaveLength(2)
    expect(versions[0]?.dag).toEqual(graph.dag)
    const kept = await db.select().from(stages).where(eq(stages.graphId, graph.id))
    expect(kept).toHaveLength(1)
    expect(await latestGraph(db, task.id).then((g) => g?.version)).toBe(2)
  })

  test('replaying the same review completion does not create a second round', async () => {
    const { task } = await make()
    const round = { loop: 'spec', round: 1, verdict: 'revise', findings: [] } as const

    await recordRound(db, task.id, round)
    await recordRound(db, task.id, round)

    const rows = await db.select().from(iterations).where(eq(iterations.taskId, task.id))
    expect(rows).toHaveLength(1)
  })
})
