import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'
import { appendOwnerMessage, openConversation } from '@specmate/core'
import {
  conversationMessages,
  createConversationStore,
  createDb,
  type Database,
  decisions,
  stages,
  tasks,
} from '@specmate/db'
import type { StageExecution } from '@specmate/runner'
import { and, eq, inArray } from 'drizzle-orm'
import {
  BudgetDecisionRequiresOptionError,
  BudgetExhaustedResumeError,
  BudgetRaiseTooLowError,
  BudgetRaiseValueError,
  Engine,
  type EngineSettings,
  NotParkedError,
} from '../src/engine.ts'
import { type RunGraphRow, taskSpend } from '../src/store.ts'
import {
  fakeConversationDispatcher,
  fakeDispatcher,
  fakeWorkspaces,
  okConversationExecution,
  okExecution,
  reload,
  seedTask,
  until,
} from './fixtures.ts'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

describeDb('budget-enforcement', () => {
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
    const conversationsDispatcher = fakeConversationDispatcher()
    const engine = new Engine({
      db,
      workspaces: ws.workspaces,
      settings: {
        // tick() polls the whole `tasks` table with no per-engine scoping, so
        // a concurrently-running test file's own task can otherwise steal the
        // one dispatch slot a concurrency of 1 would allow — generous enough
        // that this test's own task is never starved by unrelated ones.
        stageConcurrency: 25,
        stageAttemptCap: 2,
        conversationConcurrency: 25,
        availableProviders: ['claude-code'],
        ...overrides,
      },
      dispatcher: stagesDispatcher.dispatcher,
      conversationDispatcher: conversationsDispatcher.dispatcher,
    })
    engines.push(engine)

    return { engine, ws, stagesDispatcher, conversationsDispatcher }
  }

  async function seed(options: Parameters<typeof seedTask>[1] = {}) {
    const seeded = await seedTask(db, options)
    created.push(seeded.task.id)

    return seeded
  }

  async function openDecisions(taskId: string) {
    return db
      .select()
      .from(decisions)
      .where(and(eq(decisions.taskId, taskId), eq(decisions.status, 'open')))
  }

  async function seedMessage(taskId: string) {
    const store = createConversationStore(db)
    const conversation = await openConversation(store, {
      taskId,
      idempotencyKey: crypto.randomUUID(),
    })

    return appendOwnerMessage(store, {
      conversationId: conversation.id,
      content: 'What changed?',
      idempotencyKey: crypto.randomUUID(),
    })
  }

  /**
   * A finished attempt inserted directly, bypassing live dispatch — the only
   * practical way to put a task over budget in a test, since a real dispatch
   * in these tests completes in milliseconds, nowhere near a meaningful
   * agent-minutes figure.
   */
  async function seedSpentAttempt(
    graph: RunGraphRow,
    overrides: { nodeKey?: string; costUsd?: number | null; durationMinutes?: number } = {},
  ) {
    const startedAt = new Date('2026-01-01T00:00:00Z')
    const durationMs = (overrides.durationMinutes ?? 1) * 60_000
    await db.insert(stages).values({
      taskId: graph.taskId,
      graphId: graph.id,
      nodeKey: overrides.nodeKey ?? 'planning',
      role: 'planner',
      provider: 'claude-code',
      status: 'succeeded',
      attempt: 1,
      startedAt,
      finishedAt: new Date(startedAt.getTime() + durationMs),
      cost: 'costUsd' in overrides ? { costUsd: overrides.costUsd } : { costUsd: 0 },
    })
  }

  describe('the dispatch check', () => {
    test('an exhausted cost budget refuses the claim before any stage row is inserted, and pauses with a decision naming it — REQ-1502, REQ-1503, AC-1504, AC-1506', async () => {
      const { engine, stagesDispatcher } = makeEngine()
      const { task, graph } = await seed({ at: 'specify', budgets: { max_cost_usd: 1 } })
      await seedSpentAttempt(graph, { costUsd: 1 })

      await engine.tick()
      await engine.idle()

      expect(stagesDispatcher.dispatches.filter((d) => d.task.id === task.id)).toHaveLength(0)
      const after = await reload(db, task.id)
      expect(after.status).toBe('paused')
      expect(after.resumeStatus).toBe('specify')

      const stageRows = await db.select().from(stages).where(eq(stages.taskId, task.id))
      expect(stageRows).toHaveLength(1)

      const open = await openDecisions(task.id)
      expect(open).toHaveLength(1)
      expect(open[0]).toMatchObject({
        nodeKey: 'paused',
        key: 'budget-exhausted',
        kind: 'escalation',
        blocking: true,
      })
      expect(open[0]?.options).toEqual([
        { id: 'raise:max_cost_usd', label: 'Raise the cost budget' },
        { id: 'cancel', label: 'Cancel this task' },
      ])
      expect(open[0]?.promptMd).toContain('specify')
      expect(open[0]?.promptMd).toContain('$1.00')
    })

    test('a running stage that pushes spend past a budget finishes and commits; only the next dispatch is refused — REQ-1502, AC-1505', async () => {
      const { engine, stagesDispatcher } = makeEngine()
      const { task } = await seed({ at: 'specify', budgets: { max_cost_usd: 1 } })
      stagesDispatcher.plan(() =>
        okExecution('planner', {
          telemetry: { model: 'stub', tokens: null, costUsd: 5, raw: null },
        }),
      )

      await engine.tick()
      await engine.idle()

      const midRun = await reload(db, task.id)
      expect(midRun.status).toBe('spec_review')
      const [stage] = await db.select().from(stages).where(eq(stages.taskId, task.id))
      expect(stage).toMatchObject({ status: 'succeeded' })

      await engine.tick()
      await engine.idle()
      expect((await reload(db, task.id)).status).toBe('paused')
    })

    test('a queued conversation response reaches the same check as a stage dispatch — REQ-1501, REQ-1502, AC-1503', async () => {
      const { engine, conversationsDispatcher } = makeEngine()
      const { task, graph } = await seed({
        at: 'planning',
        status: 'human_kickoff_gate',
        budgets: { max_cost_usd: 1 },
      })
      await seedSpentAttempt(graph, { costUsd: 1 })
      const { response } = await seedMessage(task.id)

      await engine.tick()
      await engine.idle()

      expect(conversationsDispatcher.dispatches.filter((d) => d.task.id === task.id)).toHaveLength(
        0,
      )
      const [stillQueued] = await db
        .select()
        .from(conversationMessages)
        .where(eq(conversationMessages.id, response.id))
      expect(stillQueued?.status).toBe('queued')
      const after = await reload(db, task.id)
      expect(after.status).toBe('paused')
      expect(after.resumeStatus).toBe('human_kickoff_gate')
    })

    test('a queued conversation response never dispatches once the task is already paused for budget exhaustion — REQ-1502, REQ-1503', async () => {
      const { engine } = makeEngine()
      const { task, graph } = await seed({ at: 'specify', budgets: { max_cost_usd: 1 } })
      await seedSpentAttempt(graph, { costUsd: 1 })
      await engine.tick()
      await engine.idle()
      assert((await reload(db, task.id)).status === 'paused')

      const { response } = await seedMessage(task.id)
      await engine.tick()
      await engine.idle()

      const [stillQueued] = await db
        .select()
        .from(conversationMessages)
        .where(eq(conversationMessages.id, response.id))
      expect(stillQueued?.status).toBe('queued')
      expect((await reload(db, task.id)).status).toBe('paused')
    })

    test('a queued conversation response still dispatches for a task paused for a reason other than budget — REQ-1502', async () => {
      const { engine, stagesDispatcher, conversationsDispatcher } = makeEngine()
      const { task } = await seed({ at: 'specify' })
      let finish: (value: StageExecution) => void = () => {}
      stagesDispatcher.plan(
        () =>
          new Promise((resolve) => {
            finish = resolve
          }),
      )
      await engine.tick()
      await until(() => stagesDispatcher.dispatches.length === 1)
      const [running] = await db.select().from(stages).where(eq(stages.taskId, task.id))
      assert(running)

      await engine.stopStage({
        taskId: task.id,
        stageId: running.id,
        graphId: running.graphId,
        nodeKey: running.nodeKey,
        attempt: running.attempt,
        actor: 'owner',
      })
      finish(okExecution('planner'))
      expect((await reload(db, task.id)).status).toBe('paused')

      const { response } = await seedMessage(task.id)
      conversationsDispatcher.plan(() => okConversationExecution('Still here.'))
      await engine.tick()
      await engine.idle()

      const [answered] = await db
        .select()
        .from(conversationMessages)
        .where(eq(conversationMessages.id, response.id))
      expect(answered).toMatchObject({ status: 'completed' })
    })

    test('a task whose runs report no cost still pauses once its agent-minutes budget is reached — REQ-1505, AC-1514', async () => {
      const { engine, stagesDispatcher } = makeEngine()
      const { task, graph } = await seed({ at: 'specify', budgets: { max_wall_clock_minutes: 1 } })
      await seedSpentAttempt(graph, { costUsd: null, durationMinutes: 2 })

      await engine.tick()
      await engine.idle()

      expect(stagesDispatcher.dispatches.filter((d) => d.task.id === task.id)).toHaveLength(0)
      expect((await reload(db, task.id)).status).toBe('paused')
      const open = await openDecisions(task.id)
      expect(open[0]?.options.map((option) => option.id)).toEqual([
        'raise:max_wall_clock_minutes',
        'cancel',
      ])
      expect(open[0]?.promptMd).toMatch(/incomplete/i)
    })
  })

  describe('pausing loses nothing', () => {
    test('a refused claim leaves every existing row exactly as it was — REQ-1503, AC-1507', async () => {
      const { engine } = makeEngine()
      const { task, graph } = await seed({ at: 'specify', budgets: { max_cost_usd: 1 } })
      await seedSpentAttempt(graph, { costUsd: 1, nodeKey: 'planning' })
      const before = await db.select().from(stages).where(eq(stages.taskId, task.id))

      await engine.tick()
      await engine.idle()

      const after = await db.select().from(stages).where(eq(stages.taskId, task.id))
      expect(after).toEqual(before)
    })
  })

  describe('raising a budget', () => {
    async function seedPaused(budgets: { max_cost_usd?: number; max_wall_clock_minutes?: number }) {
      const { engine } = makeEngine()
      const { task, graph } = await seed({ at: 'specify', budgets })
      await seedSpentAttempt(graph, { costUsd: budgets.max_cost_usd ?? 1 })
      await engine.tick()
      await engine.idle()
      assert((await reload(db, task.id)).status === 'paused')

      return { engine, task, graph }
    }

    test('records the new value and resumes the task where it stopped — REQ-1504, AC-1509, AC-1511', async () => {
      const { engine, task } = await seedPaused({ max_cost_usd: 1 })

      const resumed = await engine.raiseBudget(task.id, 'evgeny', 'max_cost_usd', 5)

      expect(resumed.status).toBe('specify')
      expect(resumed.budgets.max_cost_usd).toBe(5)
      expect((await reload(db, task.id)).status).toBe('specify')
    })

    test('a raise at or below current spend is refused, naming the spend, leaving the task paused — REQ-1504, AC-1510', async () => {
      const { engine, task } = await seedPaused({ max_cost_usd: 1 })

      await expect(engine.raiseBudget(task.id, 'evgeny', 'max_cost_usd', 1)).rejects.toThrow(
        BudgetRaiseTooLowError,
      )
      expect((await reload(db, task.id)).status).toBe('paused')
      expect((await reload(db, task.id)).budgets.max_cost_usd).toBe(1)
    })

    test('a raise within float-drift epsilon of current spend is refused rather than silently resuming into a re-pause — REQ-1504', async () => {
      const { engine } = makeEngine()
      const { task, graph } = await seed({ at: 'specify', budgets: { max_cost_usd: 1 } })
      // Just under the cap by less than BUDGET_EPSILON — computeSpend
      // already reads this as exhausted, so the raise check must agree.
      await seedSpentAttempt(graph, { costUsd: 0.9999999999999999 })
      await engine.tick()
      await engine.idle()
      assert((await reload(db, task.id)).status === 'paused')

      await expect(engine.raiseBudget(task.id, 'evgeny', 'max_cost_usd', 1)).rejects.toThrow(
        BudgetRaiseTooLowError,
      )
      expect((await reload(db, task.id)).status).toBe('paused')
    })

    test('refuses to raise a budget on a task that is not paused', async () => {
      const { engine } = makeEngine()
      const { task } = await seed({ at: 'specify' })

      await expect(engine.raiseBudget(task.id, 'evgeny', 'max_cost_usd', 100)).rejects.toThrow(
        NotParkedError,
      )
    })

    test('the generic resume operation refuses a task still paused for exhaustion — REQ-1503, AC-1508', async () => {
      const { engine, task } = await seedPaused({ max_cost_usd: 1 })

      await expect(engine.resume(task.id, 'evgeny')).rejects.toThrow(BudgetExhaustedResumeError)
      expect((await reload(db, task.id)).status).toBe('paused')
    })

    test('answering the exhaustion decision with a value at or below spend is refused and leaves it open; a sufficient value resumes — REQ-1503, REQ-1504', async () => {
      const { engine, task } = await seedPaused({ max_cost_usd: 1 })
      const [decision] = await openDecisions(task.id)
      assert(decision)

      await expect(
        engine.answer({
          taskId: task.id,
          decisionId: decision.id,
          actor: 'evgeny',
          optionId: 'raise:max_cost_usd',
          text: '1',
        }),
      ).rejects.toThrow(BudgetRaiseTooLowError)
      expect(
        (await db.select().from(decisions).where(eq(decisions.id, decision.id)))[0]?.status,
      ).toBe('open')
      expect((await reload(db, task.id)).status).toBe('paused')

      const resumed = await engine.answer({
        taskId: task.id,
        decisionId: decision.id,
        actor: 'evgeny',
        optionId: 'raise:max_cost_usd',
        text: '5',
      })

      expect(resumed.status).toBe('specify')
      expect(
        (await db.select().from(decisions).where(eq(decisions.id, decision.id)))[0],
      ).toMatchObject({ status: 'answered' })
    })

    test('answering cancel cancels the task through the existing operation — REQ-1503', async () => {
      const { engine, task } = await seedPaused({ max_cost_usd: 1 })
      const [decision] = await openDecisions(task.id)
      assert(decision)

      await engine.answer({
        taskId: task.id,
        decisionId: decision.id,
        actor: 'evgeny',
        optionId: 'cancel',
      })

      expect((await reload(db, task.id)).status).toBe('cancelled')
      expect(
        (await db.select().from(decisions).where(eq(decisions.id, decision.id)))[0],
      ).toMatchObject({ status: 'answered', answerMd: 'Cancel this task' })
    })

    test('a bare free-text answer is refused rather than stranding the task paused — REQ-1503', async () => {
      const { engine, task } = await seedPaused({ max_cost_usd: 1 })
      const [decision] = await openDecisions(task.id)
      assert(decision)

      await expect(
        engine.answer({
          taskId: task.id,
          decisionId: decision.id,
          actor: 'evgeny',
          text: 'please just raise it',
        }),
      ).rejects.toThrow(BudgetDecisionRequiresOptionError)
      expect((await reload(db, task.id)).status).toBe('paused')
      expect(
        (await db.select().from(decisions).where(eq(decisions.id, decision.id)))[0]?.status,
      ).toBe('open')
    })

    test('answering with an option for a budget this decision never reached is refused, not silently accepted — REQ-1503', async () => {
      const { engine, task } = await seedPaused({ max_cost_usd: 1 })
      const [decision] = await openDecisions(task.id)
      assert(decision)
      // Only the cost budget is reached, so only `raise:max_cost_usd` and
      // `cancel` are legitimately offered — `raise:max_wall_clock_minutes`
      // merely looks like a raise option.
      expect(decision.options.map((option) => option.id)).not.toContain(
        'raise:max_wall_clock_minutes',
      )

      await expect(
        engine.answer({
          taskId: task.id,
          decisionId: decision.id,
          actor: 'evgeny',
          optionId: 'raise:max_wall_clock_minutes',
          text: '60',
        }),
      ).rejects.toThrow(BudgetDecisionRequiresOptionError)
      expect((await reload(db, task.id)).status).toBe('paused')
      expect((await reload(db, task.id)).budgets.max_wall_clock_minutes).not.toBe(60)
      expect(
        (await db.select().from(decisions).where(eq(decisions.id, decision.id)))[0]?.status,
      ).toBe('open')
    })

    test('answering with an option id this decision never offered at all is refused rather than stranding the task paused — REQ-1503', async () => {
      const { engine, task } = await seedPaused({ max_cost_usd: 1 })
      const [decision] = await openDecisions(task.id)
      assert(decision)

      await expect(
        engine.answer({
          taskId: task.id,
          decisionId: decision.id,
          actor: 'evgeny',
          optionId: 'not-a-real-option',
        }),
      ).rejects.toThrow(BudgetDecisionRequiresOptionError)
      expect((await reload(db, task.id)).status).toBe('paused')
      expect(
        (await db.select().from(decisions).where(eq(decisions.id, decision.id)))[0]?.status,
      ).toBe('open')
    })

    test('dismissal is refused rather than stranding the task paused — REQ-1503', async () => {
      const { engine, task } = await seedPaused({ max_cost_usd: 1 })
      const [decision] = await openDecisions(task.id)
      assert(decision)

      await expect(
        engine.dismiss({ taskId: task.id, decisionId: decision.id, actor: 'evgeny' }),
      ).rejects.toThrow(BudgetDecisionRequiresOptionError)
      expect((await reload(db, task.id)).status).toBe('paused')
      expect(
        (await db.select().from(decisions).where(eq(decisions.id, decision.id)))[0]?.status,
      ).toBe('open')
    })

    test('a non-integer raise of the agent-minutes budget is refused — REQ-1504', async () => {
      const { engine } = makeEngine()
      const { task, graph } = await seed({ at: 'specify', budgets: { max_wall_clock_minutes: 1 } })
      await seedSpentAttempt(graph, { costUsd: null, durationMinutes: 2 })
      await engine.tick()
      await engine.idle()
      assert((await reload(db, task.id)).status === 'paused')
      const [decision] = await openDecisions(task.id)
      assert(decision)

      await expect(
        engine.answer({
          taskId: task.id,
          decisionId: decision.id,
          actor: 'evgeny',
          optionId: 'raise:max_wall_clock_minutes',
          text: '90.5',
        }),
      ).rejects.toThrow(BudgetRaiseValueError)
      expect((await reload(db, task.id)).status).toBe('paused')
    })

    test('raising one of two simultaneously exhausted budgets leaves the task paused and the decision open — REQ-1504', async () => {
      const { engine } = makeEngine()
      const { task, graph } = await seed({
        at: 'specify',
        budgets: { max_cost_usd: 1, max_wall_clock_minutes: 1 },
      })
      await seedSpentAttempt(graph, { costUsd: 1, durationMinutes: 2 })
      await engine.tick()
      await engine.idle()
      assert((await reload(db, task.id)).status === 'paused')
      const [decision] = await openDecisions(task.id)
      assert(decision)

      const raised = await engine.raiseBudget(task.id, 'evgeny', 'max_cost_usd', 100)

      expect(raised.status).toBe('paused')
      const after = await reload(db, task.id)
      expect(after.status).toBe('paused')
      expect(after.budgets.max_cost_usd).toBe(100)
      const stillOpen = (await db.select().from(decisions).where(eq(decisions.id, decision.id)))[0]
      expect(stillOpen?.status).toBe('open')
      // The decision is refreshed in place: it stops offering to raise the
      // budget that was just cleared, and its prompt states the new cap
      // rather than the one that no longer applies — REQ-1503.
      expect(stillOpen?.options.map((option) => option.id)).toEqual([
        'raise:max_wall_clock_minutes',
        'cancel',
      ])
      expect(stillOpen?.promptMd).toContain('$100.00')

      const resumed = await engine.raiseBudget(task.id, 'evgeny', 'max_wall_clock_minutes', 60)
      expect(resumed.status).toBe('specify')
    })
  })

  describe('end to end', () => {
    test('a task runs, pauses on its cost budget, is raised, and resumes into its next stage — AC-1504, AC-1506, AC-1509', async () => {
      const { engine, stagesDispatcher } = makeEngine()
      const { task } = await seed({ at: 'specify', budgets: { max_cost_usd: 1 } })

      stagesDispatcher.plan(() =>
        okExecution('planner', {
          telemetry: { model: 'stub', tokens: null, costUsd: 0.4, raw: null },
        }),
      )
      await engine.tick()
      await engine.idle()
      expect((await reload(db, task.id)).status).toBe('spec_review')

      // This run's own telemetry takes the task past its budget — REQ-1502
      // says it still completes and commits.
      stagesDispatcher.plan(() =>
        okExecution('reviewer', {
          verdict: 'approve',
          telemetry: { model: 'stub', tokens: null, costUsd: 0.7, raw: null },
        }),
      )
      await engine.tick()
      await engine.idle()
      expect((await reload(db, task.id)).status).toBe('human_spec_gate')

      // Approving a gate is not itself a dispatch, so the exhausted budget
      // does not block it; the next *stage* dispatch is what refuses.
      await engine.approve(task.id, 'evgeny')
      expect((await reload(db, task.id)).status).toBe('implement')

      await engine.tick()
      await engine.idle()
      expect(
        stagesDispatcher.dispatches.filter(
          (d) => d.task.id === task.id && d.node.key === 'implement',
        ),
      ).toHaveLength(0)
      const paused = await reload(db, task.id)
      expect(paused.status).toBe('paused')
      expect(paused.resumeStatus).toBe('implement')
      const open = await openDecisions(task.id)
      expect(open[0]?.promptMd).toContain('implement')

      await engine.raiseBudget(task.id, 'evgeny', 'max_cost_usd', 10)
      expect((await reload(db, task.id)).status).toBe('implement')

      stagesDispatcher.plan(() => okExecution('implementer'))
      await engine.tick()
      await engine.idle()
      expect((await reload(db, task.id)).status).toBe('validate')
    })

    test('the same walk with cost entirely unreported pauses on agent-minutes instead — AC-1512, AC-1514', async () => {
      const { engine, stagesDispatcher } = makeEngine()
      const { task, graph } = await seed({
        at: 'specify',
        budgets: { max_wall_clock_minutes: 1 },
      })
      await seedSpentAttempt(graph, { costUsd: null, durationMinutes: 2, nodeKey: 'planning' })

      stagesDispatcher.plan(() =>
        okExecution('planner', {
          telemetry: { model: 'stub', tokens: null, costUsd: null, raw: null },
        }),
      )
      await engine.tick()
      await engine.idle()

      expect(stagesDispatcher.dispatches.filter((d) => d.task.id === task.id)).toHaveLength(0)
      const paused = await reload(db, task.id)
      expect(paused.status).toBe('paused')
      expect(paused.resumeStatus).toBe('specify')
      const open = await openDecisions(task.id)
      expect(open[0]?.options.map((option) => option.id)).toEqual([
        'raise:max_wall_clock_minutes',
        'cancel',
      ])

      await engine.raiseBudget(task.id, 'evgeny', 'max_wall_clock_minutes', 60)
      stagesDispatcher.plan(() =>
        okExecution('planner', {
          telemetry: { model: 'stub', tokens: null, costUsd: null, raw: null },
        }),
      )
      await engine.tick()
      await engine.idle()
      expect((await reload(db, task.id)).status).toBe('spec_review')
    })
  })

  describe('spend completeness', () => {
    test('an orphaned conversation response records a real, self-timed duration rather than an unknown one — REQ-1505', async () => {
      const { engine } = makeEngine()
      const { task } = await seed({ at: 'specify' })
      const { response } = await seedMessage(task.id)
      const claimedAt = new Date(Date.now() - 5_000)
      await db
        .update(conversationMessages)
        .set({ status: 'responding', updatedAt: claimedAt })
        .where(eq(conversationMessages.id, response.id))

      expect(await engine.sweep()).toBe(1)

      const [settled] = await db
        .select()
        .from(conversationMessages)
        .where(eq(conversationMessages.id, response.id))
      expect(settled?.status).toBe('queued')
      const [entry] = settled?.telemetry ?? []
      expect(entry?.startedAt).toBe(claimedAt.toISOString())
      expect(entry?.durationMs).toBeGreaterThanOrEqual(5_000)

      const spend = await taskSpend(db, task.id)
      expect(spend.agentMinutes).toBeGreaterThan(0)
    })
  })
})
