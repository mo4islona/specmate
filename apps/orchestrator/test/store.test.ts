import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { FEATURE_BUGFIX_PIPELINE, instantiateDefinition, type ModelBindings } from '@specmate/core'
import {
  conversations,
  createDb,
  type Database,
  decisions,
  events,
  getModelDefaults,
  iterations,
  runGraphs,
  stages,
  tasks,
  updateModelDefaults,
} from '@specmate/db'
import { and, asc, eq, inArray } from 'drizzle-orm'
import {
  createTask,
  latestGraph,
  raiseDecision,
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

  async function make(at?: 'specify') {
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

    expect(task.status).toBe('planning')
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
    const { task } = await make('specify')

    expect(task.status).toBe('specify')
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
    const { task, graph } = await make('specify')
    await db.insert(stages).values({
      taskId: task.id,
      graphId: graph.id,
      nodeKey: 'specify',
      role: 'planner',
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

  describe('raiseDecision', () => {
    const request = {
      nodeKey: 'specify' as const,
      key: 'scope',
      kind: 'question' as const,
      promptMd: 'What does this cover?',
      options: [],
      blocking: true,
    }

    test('creates a decision and its inert scoped conversation', async () => {
      const { task } = await make()

      const { decision, created } = await raiseDecision(db, task.id, null, request)

      expect(created).toBe(true)
      expect(decision).toMatchObject({ nodeKey: 'specify', key: 'scope', status: 'open' })
      const [conversation] = await db
        .select()
        .from(conversations)
        .where(
          and(eq(conversations.subjectKind, 'decision'), eq(conversations.subjectId, decision.id)),
        )
      expect(conversation).toBeDefined()
      expect(conversation?.taskId).toBe(task.id)
      const raisedEvents = await db
        .select({ type: events.type })
        .from(events)
        .where(eq(events.taskId, task.id))
      expect(raisedEvents.map((e) => e.type)).toEqual(
        expect.arrayContaining(['decision.raised', 'conversation.created']),
      )
    })

    test('a second request at the same node and key attaches instead of duplicating', async () => {
      const { task } = await make()

      const first = await raiseDecision(db, task.id, null, request)
      const second = await raiseDecision(db, task.id, null, { ...request, promptMd: 'A retry' })

      expect(second.created).toBe(false)
      expect(second.decision.id).toBe(first.decision.id)
      const rows = await db.select().from(decisions).where(eq(decisions.taskId, task.id))
      expect(rows).toHaveLength(1)
      const conversationRows = await db
        .select()
        .from(conversations)
        .where(eq(conversations.taskId, task.id))
      expect(conversationRows).toHaveLength(1)
    })

    test('a re-ask carrying a changed prompt, options, kind, or blocking flag updates the still-open decision in place', async () => {
      const { task } = await make()

      const first = await raiseDecision(db, task.id, null, request)
      const second = await raiseDecision(db, task.id, null, {
        ...request,
        promptMd: 'A corrected question',
        options: [{ id: 'a', label: 'Option A' }],
        blocking: false,
      })

      expect(second.created).toBe(false)
      expect(second.decision.id).toBe(first.decision.id)
      expect(second.decision).toMatchObject({
        promptMd: 'A corrected question',
        options: [{ id: 'a', label: 'Option A' }],
        blocking: false,
      })
      const [stored] = await db.select().from(decisions).where(eq(decisions.id, first.decision.id))
      expect(stored).toMatchObject({ promptMd: 'A corrected question', blocking: false })
    })

    test('a re-ask carrying no changes leaves the decision untouched', async () => {
      const { task } = await make()

      const first = await raiseDecision(db, task.id, null, request)
      const second = await raiseDecision(db, task.id, null, request)

      expect(second.created).toBe(false)
      expect(second.decision).toEqual(first.decision)
    })

    test('two nodes escalating under one key stay two decisions — REQ-1202, AC-1207', async () => {
      const { task } = await make()
      const escalation = { ...request, kind: 'escalation' as const, blocking: true }

      const first = await raiseDecision(db, task.id, null, escalation)
      const second = await raiseDecision(db, task.id, null, {
        ...escalation,
        nodeKey: 'implement' as const,
      })

      expect(second.created).toBe(true)
      expect(second.decision.id).not.toBe(first.decision.id)
      expect(second.decision.nodeKey).toBe('implement')
    })

    test('two nodes asking one non-blocking question stay one decision — REQ-1202, AC-1228', async () => {
      const { task } = await make()
      const question = { ...request, blocking: false }

      const first = await raiseDecision(db, task.id, null, question)
      const second = await raiseDecision(db, task.id, null, {
        ...question,
        nodeKey: 'implement' as const,
        promptMd: 'Asked again, later in the walk',
      })

      expect(second.created).toBe(false)
      expect(second.decision.id).toBe(first.decision.id)
      // The record keeps the node that first raised it; only what is asked changes.
      expect(second.decision.nodeKey).toBe('specify')
      expect(second.decision.promptMd).toBe('Asked again, later in the walk')
    })

    test('asking again after an answer opens a fresh decision, leaving the old one readable', async () => {
      const { task } = await make()

      const { decision: answered } = await raiseDecision(db, task.id, null, request)
      await db
        .update(decisions)
        .set({ status: 'answered', answerMd: 'Both.', answeredBy: 'owner' })
        .where(eq(decisions.id, answered.id))

      const second = await raiseDecision(db, task.id, null, request)

      expect(second.created).toBe(true)
      expect(second.decision.id).not.toBe(answered.id)
      const rows = await db.select().from(decisions).where(eq(decisions.taskId, task.id))
      expect(rows).toHaveLength(2)
      const stillAnswered = rows.find((row) => row.id === answered.id)
      expect(stillAnswered).toMatchObject({ status: 'answered', answerMd: 'Both.' })
    })

    test('a failure later in the same transaction rolls the decision insert back with it', async () => {
      const { task } = await make()

      await expect(
        db.transaction(async (tx) => {
          await raiseDecision(tx, task.id, null, request)
          throw new Error('simulated failure after the decision insert')
        }),
      ).rejects.toThrow('simulated failure')

      const rows = await db.select().from(decisions).where(eq(decisions.taskId, task.id))
      expect(rows).toHaveLength(0)
      const conversationRows = await db
        .select()
        .from(conversations)
        .where(eq(conversations.taskId, task.id))
      expect(conversationRows).toHaveLength(0)
    })

    test('a re-ask that changes the prompt in place still emits a decision.raised event', async () => {
      const { task } = await make()

      await raiseDecision(db, task.id, null, request)
      await raiseDecision(db, task.id, null, { ...request, promptMd: 'A corrected question' })

      const raisedEvents = await db
        .select({ type: events.type })
        .from(events)
        .where(and(eq(events.taskId, task.id), eq(events.type, 'decision.raised')))
      expect(raisedEvents).toHaveLength(2)
    })

    test('a re-ask from a later attempt reattaches the decision to that attempt’s stage', async () => {
      const { task, graph } = await make()
      const [firstAttempt] = await db
        .insert(stages)
        .values({
          taskId: task.id,
          graphId: graph.id,
          nodeKey: 'specify',
          role: 'planner',
          provider: 'claude-code',
          attempt: 1,
        })
        .returning()
      const [secondAttempt] = await db
        .insert(stages)
        .values({
          taskId: task.id,
          graphId: graph.id,
          nodeKey: 'specify',
          role: 'planner',
          provider: 'claude-code',
          attempt: 2,
        })
        .returning()
      if (!firstAttempt || !secondAttempt) throw new Error('fixture stages not created')

      const first = await raiseDecision(db, task.id, firstAttempt.id, request)
      expect(first.decision.stageId).toBe(firstAttempt.id)

      const second = await raiseDecision(db, task.id, secondAttempt.id, request)

      expect(second.decision.id).toBe(first.decision.id)
      expect(second.decision.stageId).toBe(secondAttempt.id)
      const [stored] = await db.select().from(decisions).where(eq(decisions.id, first.decision.id))
      expect(stored?.stageId).toBe(secondAttempt.id)
    })

    test('a re-ask with options in a different key order is treated as unchanged', async () => {
      const { task } = await make()
      const optioned = { ...request, options: [{ id: 'a', label: 'Option A' }] }

      const first = await raiseDecision(db, task.id, null, optioned)
      const reordered = {
        ...optioned,
        options: [{ label: 'Option A', id: 'a' } as { id: string; label: string }],
      }
      const second = await raiseDecision(db, task.id, null, reordered)

      expect(second.created).toBe(false)
      expect(second.decision).toEqual(first.decision)
      const raisedEvents = await db
        .select({ type: events.type })
        .from(events)
        .where(and(eq(events.taskId, task.id), eq(events.type, 'decision.raised')))
      expect(raisedEvents).toHaveLength(1)
    })

    test('two concurrent raisers for the same (node, key) attach to one winner instead of one throwing', async () => {
      const { task } = await make()

      // Neither call holds the task's advisory lock here — this is exactly
      // the race the "attach, don't duplicate" contract must survive without
      // a caller-enforced guarantee.
      const [first, second] = await Promise.all([
        raiseDecision(db, task.id, null, request),
        raiseDecision(db, task.id, null, request),
      ])

      expect(first.decision.id).toBe(second.decision.id)
      expect([first.created, second.created].filter(Boolean)).toHaveLength(1)
      const rows = await db.select().from(decisions).where(eq(decisions.taskId, task.id))
      expect(rows).toHaveLength(1)
    })
  })

  describe('model bindings', () => {
    let originalDefaults: ModelBindings

    beforeAll(async () => {
      originalDefaults = await getModelDefaults(db)
    })

    afterAll(async () => {
      await updateModelDefaults(db, originalDefaults)
    })

    test('a task created without an override stores the then-current defaults, and a later default change does not alter it (AC-333, AC-334)', async () => {
      await updateModelDefaults(db, { researcher: { model: 'claude-sonnet-5' } })
      const { task } = await make()
      expect(task.modelBindings.researcher.model).toBe('claude-sonnet-5')

      await updateModelDefaults(db, { researcher: { model: 'claude-fable-5' } })
      const [reloaded] = await db.select().from(tasks).where(eq(tasks.id, task.id)).limit(1)
      expect(reloaded?.modelBindings.researcher.model).toBe('claude-sonnet-5')
    })

    test('a task created with a one-role override stores that override and current defaults for the rest (AC-1038)', async () => {
      await updateModelDefaults(db, { reviewer: { model: 'claude-sonnet-5' } })
      const slug = `store-${crypto.randomUUID().slice(0, 8)}`
      const { task } = await createTask(db, {
        slug,
        title: `Fixture ${slug}`,
        type: 'feature',
        repoUrl: 'file:///dev/null',
        modelBindings: { implementer: { model: 'claude-fable-5' } },
      })
      created.push(task.id)

      expect(task.modelBindings.implementer.model).toBe('claude-fable-5')
      expect(task.modelBindings.reviewer.model).toBe('claude-sonnet-5')
    })

    test('a task created with an effort-only override stores that effort and inherits the current default model for the same role (AC-1038)', async () => {
      await updateModelDefaults(db, { implementer: { model: 'claude-sonnet-5' } })
      const slug = `store-${crypto.randomUUID().slice(0, 8)}`
      const { task } = await createTask(db, {
        slug,
        title: `Fixture ${slug}`,
        type: 'feature',
        repoUrl: 'file:///dev/null',
        modelBindings: { implementer: { reasoningEffort: 'max' } },
      })
      created.push(task.id)

      expect(task.modelBindings.implementer).toEqual({
        model: 'claude-sonnet-5',
        reasoningEffort: 'max',
      })
    })
  })
})
