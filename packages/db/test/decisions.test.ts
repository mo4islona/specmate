import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { conversations, createDb, type Database, decisions, tasks } from '../src/index.ts'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

describeDb('decision persistence', () => {
  let db: Database
  let taskId = ''

  beforeAll(async () => {
    db = createDb(url)
    const [task] = await db
      .insert(tasks)
      .values({
        slug: `decision-${randomUUID().slice(0, 8)}`,
        title: 'Decision fixture',
        type: 'feature',
        repoUrl: 'https://github.com/example/decision-fixture',
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

  test('rejects a second open decision for the same node and key', async () => {
    const [first] = await db
      .insert(decisions)
      .values({
        taskId,
        nodeKey: 'specify',
        key: 'ambiguous-scope',
        kind: 'question',
        promptMd: 'What does "dark mode" mean here?',
      })
      .returning()
    assert(first)

    await expect(
      (async () =>
        db.insert(decisions).values({
          taskId,
          nodeKey: 'specify',
          key: 'ambiguous-scope',
          kind: 'question',
          promptMd: 'A second question with the same identity',
        }))(),
    ).rejects.toThrow()

    // A resolved decision under the same (node, key) does not block a fresh one.
    await db
      .update(decisions)
      .set({ status: 'answered', answerMd: 'Light and dark both.' })
      .where(eq(decisions.id, first.id))

    const [second] = await db
      .insert(decisions)
      .values({
        taskId,
        nodeKey: 'specify',
        key: 'ambiguous-scope',
        kind: 'question',
        promptMd: 'Asking again after the answer',
      })
      .returning()
    assert(second)
    expect(second.id).not.toBe(first.id)

    const rows = await db.select().from(decisions).where(eq(decisions.taskId, taskId))
    expect(rows).toHaveLength(2)
  })

  test('one decision-scoped conversation per decision, cascading with the task', async () => {
    const [task] = await db
      .insert(tasks)
      .values({
        slug: `decision-conversation-${randomUUID().slice(0, 8)}`,
        title: 'Decision conversation fixture',
        type: 'feature',
        repoUrl: 'https://github.com/example/decision-conversation',
      })
      .returning()
    assert(task)

    const [decision] = await db
      .insert(decisions)
      .values({
        taskId: task.id,
        nodeKey: 'planning',
        key: 'scope',
        kind: 'question',
        promptMd: 'Which repository owns this?',
      })
      .returning()
    assert(decision)

    const [conversation] = await db
      .insert(conversations)
      .values({ taskId: task.id, subjectKind: 'decision', subjectId: decision.id })
      .returning()
    assert(conversation)

    await expect(
      (async () =>
        db
          .insert(conversations)
          .values({ taskId: task.id, subjectKind: 'decision', subjectId: decision.id }))(),
    ).rejects.toThrow()

    await db.delete(tasks).where(eq(tasks.id, task.id))

    expect(
      await db.select().from(conversations).where(eq(conversations.id, conversation.id)),
    ).toHaveLength(0)
    expect(await db.select().from(decisions).where(eq(decisions.id, decision.id))).toHaveLength(0)
  })
})
