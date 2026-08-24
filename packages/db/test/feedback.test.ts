import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import type { PinnedGraph } from '@specmate/core'
import { eq } from 'drizzle-orm'
import { createDb, type Database, feedback, runGraphs, stages, tasks } from '../src/index.ts'

/** The rows under test do not read the graph; it only has to be one. */
const EMPTY_DAG = {
  pipeline: 'feature-bugfix',
  entry: 'planning',
  terminal: 'archived',
  nodes: [],
} satisfies PinnedGraph

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

describeDb('feedback persistence', () => {
  let db: Database
  let taskId = ''

  beforeAll(async () => {
    db = createDb(url)
    const [task] = await db
      .insert(tasks)
      .values({
        slug: `feedback-${randomUUID().slice(0, 8)}`,
        title: 'Feedback fixture',
        type: 'bugfix',
        repoUrl: 'https://github.com/example/feedback-fixture',
        baseBranch: 'main',
      })
      .returning()
    if (!task) throw new Error('task insert returned no row')

    taskId = task.id
  })

  afterAll(async () => {
    try {
      if (taskId) await db.delete(tasks).where(eq(tasks.id, taskId))
    } finally {
      await db.$client.close()
    }
  })

  test('stores unpinned and stage-pinned comments', async () => {
    const [graph] = await db.insert(runGraphs).values({ taskId, dag: EMPTY_DAG }).returning()
    if (!graph) throw new Error('run graph insert returned no row')

    const [stage] = await db
      .insert(stages)
      .values({
        taskId,
        graphId: graph.id,
        nodeKey: 'review',
        role: 'reviewer',
        provider: 'codex',
      })
      .returning()
    if (!stage) throw new Error('stage insert returned no row')

    const rows = await db
      .insert(feedback)
      .values([
        {
          taskId,
          kind: 'comment',
          textMd: 'General observation',
        },
        {
          taskId,
          stageId: stage.id,
          role: stage.role,
          provider: stage.provider,
          kind: 'comment',
          textMd: 'Review-specific observation',
        },
      ])
      .returning()

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      taskId,
      stageId: null,
      role: null,
      provider: null,
      kind: 'comment',
    })
    expect(rows[1]).toMatchObject({
      taskId,
      stageId: stage.id,
      role: 'reviewer',
      provider: 'codex',
      kind: 'comment',
    })
  })
})
