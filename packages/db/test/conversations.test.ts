import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import {
  conversationMessages,
  conversations,
  createDb,
  type Database,
  runGraphs,
  stages,
  tasks,
} from '../src/index.ts'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

describeDb('conversation persistence', () => {
  let db: Database
  let taskId = ''

  beforeAll(async () => {
    db = createDb(url)
    const [task] = await db
      .insert(tasks)
      .values({
        slug: `conversation-${randomUUID().slice(0, 8)}`,
        title: 'Conversation fixture',
        type: 'feature',
        repoUrl: 'https://github.com/example/conversation',
      })
      .returning()
    assert(task)
    taskId = task.id
  })

  afterAll(async () => {
    try {
      if (taskId) await db.delete(tasks).where(eq(tasks.id, taskId))
    } finally {
      await db.$client.close()
    }
  })

  test('enforces one scoped conversation and one active response', async () => {
    const [conversation] = await db
      .insert(conversations)
      .values({ taskId, subjectKind: 'decision', subjectId: 'decision-1' })
      .returning()
    assert(conversation)
    await expect(
      (async () =>
        db
          .insert(conversations)
          .values({ taskId, subjectKind: 'decision', subjectId: 'decision-1' })
          .returning())(),
    ).rejects.toThrow()

    await db.insert(conversationMessages).values({
      conversationId: conversation.id,
      sequence: 1,
      role: 'assistant',
      status: 'responding',
      taskState: 'specify',
    })
    await expect(
      (async () =>
        db
          .insert(conversationMessages)
          .values({
            conversationId: conversation.id,
            sequence: 2,
            role: 'assistant',
            status: 'responding',
            taskState: 'specify',
          })
          .returning())(),
    ).rejects.toThrow()
  })

  test('deleting a task cascades through the conversation aggregate', async () => {
    const [task] = await db
      .insert(tasks)
      .values({
        slug: `conversation-cascade-${randomUUID().slice(0, 8)}`,
        title: 'Cascade fixture',
        type: 'feature',
        repoUrl: 'https://github.com/example/conversation-cascade',
      })
      .returning()
    assert(task)
    const [conversation] = await db.insert(conversations).values({ taskId: task.id }).returning()
    assert(conversation)

    await db.delete(tasks).where(eq(tasks.id, task.id))

    expect(
      await db.select().from(conversations).where(eq(conversations.id, conversation.id)),
    ).toHaveLength(0)
  })

  test('round-trips an interrupted stage without inventing provider usage', async () => {
    const [graph] = await db
      .insert(runGraphs)
      .values({
        taskId,
        version: 1,
        dag: { entry: 'specify', terminal: 'archived', nodes: [] } as never,
      })
      .returning()
    assert(graph)
    const [stage] = await db
      .insert(stages)
      .values({
        taskId,
        graphId: graph.id,
        nodeKey: 'specify',
        role: 'researcher',
        provider: 'claude-code',
        status: 'interrupted',
        interruptionCleanupStatus: 'succeeded',
      })
      .returning()

    expect(stage).toMatchObject({ status: 'interrupted', cost: {} })
    const enumRows = (await db.execute(
      sql`select unnest(enum_range(null::feedback_kind))::text as value`,
    )) as { value: string }[]
    expect(enumRows.map((row) => row.value)).toContain('conversation')
    expect(enumRows.map((row) => row.value)).toContain('intervention')
    expect(enumRows.map((row) => row.value)).not.toContain('question')
  })
})
