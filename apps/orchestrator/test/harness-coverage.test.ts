import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'
import { forwardTarget, StageResult } from '@specmate/core'
import {
  conversationActions,
  conversationMessages,
  conversations,
  coverageWaivers,
  createDb,
  type Database,
  decisions,
  runGraphs,
  tasks,
} from '@specmate/db'
import type { StageExecution } from '@specmate/runner'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { CoverageDecisionRequiresOptionError, Engine, type EngineSettings } from '../src/engine.ts'
import { assertNotSelfDependency, SelfDependencyError } from '../src/store.ts'
import { fakeDispatcher, fakeWorkspaces, planShape, reload, seedTask } from './fixtures.ts'

describe('assertNotSelfDependency', () => {
  test('rejects a task depending on itself', () => {
    expect(() => assertNotSelfDependency('t1', 't1')).toThrow(SelfDependencyError)
  })

  test('accepts a dependency on a different task', () => {
    expect(() => assertNotSelfDependency('t1', 't2')).not.toThrow()
  })
})

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

function result(overrides: Partial<StageResult> & { role: StageResult['role'] }): StageExecution {
  // AC-1317: a planning role's `ok` result must carry a plan, and the engine
  // now fails the attempt when it does not. Defaulted here so a test about
  // coverage need not restate it; one about the plan overrides it.
  const declaresPlan = overrides.role === 'planner' && (overrides.status ?? 'ok') === 'ok'
  const planned = declaresPlan && !overrides.plan ? { plan: planShape() } : {}

  return {
    status: 'succeeded',
    attempts: [{ attempt: 0, ok: true, durationMs: 5 }],
    result: StageResult.parse({ schema_version: 1, status: 'ok', ...overrides, ...planned }),
    telemetry: { model: 'stub-model-1', tokens: null, costUsd: null, raw: null },
  }
}

const PARTIAL = {
  classification: 'partial' as const,
  evidence_md: 'No integration suite touches the reorg path.',
}
const MISSING = {
  classification: 'missing' as const,
  evidence_md: 'Nothing exercises the reorg path end to end.',
}
const ADEQUATE = { classification: 'adequate' as const, evidence_md: 'An e2e suite covers it.' }

const HARNESS_PREREQUISITE = {
  key: 'reorg-harness',
  title: 'Harness for the reorg path',
  why_md: 'Nothing replays a reorg against real state, so no fix to it can be verified.',
}
const FIXTURE_PREREQUISITE = {
  key: 'chain-fixtures',
  title: 'Chain fixtures for the reorg harness',
  why_md: 'The harness needs a recorded chain to replay.',
}

describeDb('harness-coverage', () => {
  let db: Database
  const created: string[] = []
  const repos: string[] = []
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
    // A coverage waiver outlives the task that accepted it by design, so the
    // suite clears its own rather than leaving them behind.
    if (repos.length > 0) {
      await db.delete(coverageWaivers).where(inArray(coverageWaivers.repoUrl, repos.splice(0)))
    }
    if (created.length > 0) await db.delete(tasks).where(inArray(tasks.id, created.splice(0)))
  })

  function makeEngine(overrides: Partial<EngineSettings> = {}) {
    const ws = fakeWorkspaces()
    const stagesDispatcher = fakeDispatcher()
    const logs: string[] = []
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
      actionDispatcher: async ({ task, graph, node }) => {
        await db
          .update(tasks)
          .set({ status: forwardTarget(graph, node.key), updatedAt: new Date() })
          .where(eq(tasks.id, task.id))
      },
      log: (message) => logs.push(message),
    })
    engines.push(engine)

    return { engine, ws, stagesDispatcher, logs }
  }

  async function seed(options: Parameters<typeof seedTask>[1] = {}) {
    const seeded = await seedTask(db, options)
    created.push(seeded.task.id)
    repos.push(seeded.task.repoUrl)

    return seeded
  }

  async function openDecisions(taskId: string) {
    return db
      .select()
      .from(decisions)
      .where(and(eq(decisions.taskId, taskId), eq(decisions.status, 'open')))
  }

  describe('recording the classification', () => {
    test('records the classification and evidence from a stub planning stage, before the task advances — REQ-1401, AC-1403', async () => {
      const { engine, stagesDispatcher } = makeEngine()
      const { task } = await seed({ at: 'planning' })
      stagesDispatcher.plan(() =>
        result({ role: 'planner', status: 'ok', harness_coverage: MISSING }),
      )

      await engine.tick()
      await engine.idle()

      const after = await reload(db, task.id)
      expect(after.status).toBe('human_kickoff_gate')
      expect(after.harnessStatus).toBe('missing')
    })
  })

  describe('the coverage decision', () => {
    test('a short-of-adequate classification reaches the gate carrying an open decision with all three options — REQ-1403, AC-1407', async () => {
      const { engine, stagesDispatcher } = makeEngine()
      const { task } = await seed({ at: 'planning' })
      stagesDispatcher.plan(() =>
        result({ role: 'planner', status: 'ok', harness_coverage: PARTIAL }),
      )

      await engine.tick()
      await engine.idle()

      const after = await reload(db, task.id)
      expect(after.status).toBe('human_kickoff_gate')
      expect(after.harnessStatus).toBe('partial')
      const open = await openDecisions(task.id)
      expect(open).toHaveLength(1)
      expect(open[0]).toMatchObject({
        nodeKey: 'human_kickoff_gate',
        key: 'harness-coverage',
        blocking: false,
        status: 'open',
      })
      expect(open[0]?.options.map((o) => o.id).sort()).toEqual(['cancel', 'proceed', 'split'])
      expect(open[0]?.promptMd).toContain(PARTIAL.evidence_md)
    })

    test('adequate coverage reaches the gate with no coverage decision — AC-1410', async () => {
      const { engine, stagesDispatcher } = makeEngine()
      const { task } = await seed({ at: 'planning' })
      stagesDispatcher.plan(() =>
        result({ role: 'planner', status: 'ok', harness_coverage: ADEQUATE }),
      )

      await engine.tick()
      await engine.idle()

      const after = await reload(db, task.id)
      expect(after.status).toBe('human_kickoff_gate')
      expect(after.harnessStatus).toBe('adequate')
      expect(await openDecisions(task.id)).toEqual([])
    })

    test('answering proceed records the waiver; a later approve dispatches research — REQ-1403, AC-1408', async () => {
      const { engine, stagesDispatcher } = makeEngine()
      const { task } = await seed({ at: 'planning' })
      stagesDispatcher.plan(() =>
        result({ role: 'planner', status: 'ok', harness_coverage: PARTIAL }),
      )
      await engine.tick()
      await engine.idle()
      const [decision] = await openDecisions(task.id)
      assert(decision)

      await engine.answer({
        taskId: task.id,
        decisionId: decision.id,
        actor: 'evgeny',
        optionId: 'proceed',
      })

      const afterAnswer = await reload(db, task.id)
      expect(afterAnswer.harnessStatus).toBe('waived')
      expect(afterAnswer.status).toBe('human_kickoff_gate')
      expect(
        (await db.select().from(decisions).where(eq(decisions.id, decision.id)))[0],
      ).toMatchObject({ status: 'answered', answerMd: 'Proceed without it' })

      stagesDispatcher.plan(() => result({ role: 'planner', status: 'ok' }))
      await engine.approve(task.id, 'evgeny')
      expect((await reload(db, task.id)).status).toBe('specify')

      await engine.tick()
      await engine.idle()
      expect(stagesDispatcher.dispatches.some((d) => d.node.key === 'specify')).toBe(true)
    })

    test('approving with the coverage decision unanswered records the waiver as the decision resolves — REQ-1403, AC-1409', async () => {
      const { engine, stagesDispatcher } = makeEngine()
      const { task } = await seed({ at: 'planning' })
      stagesDispatcher.plan(() =>
        result({ role: 'planner', status: 'ok', harness_coverage: MISSING }),
      )
      await engine.tick()
      await engine.idle()
      const [decision] = await openDecisions(task.id)
      assert(decision)

      await engine.approve(task.id, 'evgeny')

      const after = await reload(db, task.id)
      expect(after.harnessStatus).toBe('waived')
      expect(after.status).toBe('specify')
      expect(
        (await db.select().from(decisions).where(eq(decisions.id, decision.id)))[0],
      ).toMatchObject({ status: 'answered', answerMd: 'Proceed without it' })
    })

    test('dismissing the coverage decision is refused — it has no dismissal to fall back to', async () => {
      const { engine, stagesDispatcher } = makeEngine()
      const { task } = await seed({ at: 'planning' })
      stagesDispatcher.plan(() =>
        result({ role: 'planner', status: 'ok', harness_coverage: MISSING }),
      )
      await engine.tick()
      await engine.idle()
      const [decision] = await openDecisions(task.id)
      assert(decision)

      await expect(
        engine.dismiss({ taskId: task.id, decisionId: decision.id, actor: 'evgeny' }),
      ).rejects.toThrow(CoverageDecisionRequiresOptionError)

      const after = await reload(db, task.id)
      expect(after.harnessStatus).toBe('missing')
      expect(
        (await db.select().from(decisions).where(eq(decisions.id, decision.id)))[0]?.status,
      ).toBe('open')
    })

    test('answering cancel cancels the task through the existing operation, dismissing any other open decision — REQ-1403', async () => {
      const { engine, stagesDispatcher } = makeEngine()
      const { task } = await seed({ at: 'planning' })
      stagesDispatcher.plan(() =>
        result({
          role: 'planner',
          status: 'ok',
          harness_coverage: MISSING,
          decisions_needed: [
            {
              key: 'scope',
              kind: 'question',
              prompt_md: 'Mobile too?',
              options: [],
              blocking: false,
            },
          ],
        }),
      )
      await engine.tick()
      await engine.idle()
      const open = await openDecisions(task.id)
      const coverage = open.find((d) => d.key === 'harness-coverage')
      assert(coverage)

      await engine.answer({
        taskId: task.id,
        decisionId: coverage.id,
        actor: 'evgeny',
        optionId: 'cancel',
      })

      const after = await reload(db, task.id)
      expect(after.status).toBe('cancelled')
      const all = await db.select().from(decisions).where(eq(decisions.taskId, task.id))
      expect(all.find((d) => d.key === 'harness-coverage')).toMatchObject({
        status: 'answered',
        answerMd: 'Cancel this task',
      })
      expect(all.find((d) => d.key === 'scope')).toMatchObject({ status: 'dismissed' })
    })

    test('discussing the coverage decision leaves it open; confirming the proposed answer invokes the existing answer path — REQ-1403, AC-1417', async () => {
      const { engine, stagesDispatcher } = makeEngine()
      const { task, graph } = await seed({ at: 'planning' })
      stagesDispatcher.plan(() =>
        result({ role: 'planner', status: 'ok', harness_coverage: PARTIAL }),
      )
      await engine.tick()
      await engine.idle()
      const [decision] = await openDecisions(task.id)
      assert(decision)

      const [conversation] = await db
        .select()
        .from(conversations)
        .where(
          and(eq(conversations.subjectKind, 'decision'), eq(conversations.subjectId, decision.id)),
        )
      assert(conversation)

      const [followUp] = await db
        .insert(conversationMessages)
        .values({
          conversationId: conversation.id,
          sequence: 1,
          role: 'assistant',
          contentMd: 'Splitting adds a task, but blocks this one until it lands.',
          status: 'completed',
          taskState: 'human_kickoff_gate',
        })
        .returning()
      assert(followUp)

      // Discussion alone leaves the decision open, and no side effect fires.
      expect(
        (await db.select().from(decisions).where(eq(decisions.id, decision.id)))[0]?.status,
      ).toBe('open')
      expect((await reload(db, task.id)).harnessStatus).toBe('partial')

      const [proposalMessage] = await db
        .insert(conversationMessages)
        .values({
          conversationId: conversation.id,
          sequence: 2,
          role: 'assistant',
          contentMd: 'I recommend proceeding — the risk is low.',
          status: 'completed',
          taskState: 'human_kickoff_gate',
        })
        .returning()
      assert(proposalMessage)
      const [action] = await db
        .insert(conversationActions)
        .values({
          taskId: task.id,
          conversationId: conversation.id,
          messageId: proposalMessage.id,
          kind: 'answer_decision',
          target: { taskId: task.id, graphId: graph.id, decisionId: decision.id },
          instruction: 'Proceed — the risk is low.',
          expectedVersion: {
            taskStatus: 'human_kickoff_gate',
            graphId: graph.id,
            decisionStatus: 'open',
          },
        })
        .returning()
      assert(action)

      // Still nothing until the owner explicitly confirms.
      expect(
        (await db.select().from(decisions).where(eq(decisions.id, decision.id)))[0]?.status,
      ).toBe('open')

      await engine.confirmAction({
        taskId: task.id,
        actionId: action.id,
        actor: 'evgeny',
        idempotencyKey: `confirm:${action.id}`,
      })

      // The chat path answers with free text, never a structured optionId —
      // it invokes the same generic answer path as any other decision, but
      // does not itself trigger split/proceed/cancel automation (§4.5).
      expect(
        (await db.select().from(decisions).where(eq(decisions.id, decision.id)))[0],
      ).toMatchObject({ status: 'answered', answerMd: 'Proceed — the risk is low.' })
      expect((await reload(db, task.id)).harnessStatus).toBe('partial')
    })
  })

  describe('the declared plan', () => {
    test('adequate coverage with proposed prerequisites still raises the choice — AC-1418', async () => {
      const { engine, stagesDispatcher } = makeEngine()
      const { task } = await seed({ at: 'planning' })
      stagesDispatcher.plan(() =>
        result({
          role: 'planner',
          status: 'ok',
          harness_coverage: ADEQUATE,
          plan: planShape({ prerequisites: [HARNESS_PREREQUISITE] }),
        }),
      )

      await engine.tick()
      await engine.idle()

      const after = await reload(db, task.id)
      expect(after.status).toBe('human_kickoff_gate')
      expect(after.harnessStatus).toBe('adequate')
      expect(after.planSize).toBe('medium')
      const [open] = await openDecisions(task.id)
      assert(open)
      expect(open.key).toBe('harness-coverage')
      expect(open.promptMd).toContain(HARNESS_PREREQUISITE.title)
      expect(open.options.map((o) => o.id)).toEqual(['split', 'proceed', 'cancel'])
    })

    test('a task at the depth cap is offered no split, and is told why — AC-1419, AC-636', async () => {
      const { engine, stagesDispatcher } = makeEngine()
      const { task: origin } = await seed()
      const { task } = await seed({
        at: 'planning',
        originTaskId: origin.id,
        planDepth: 1,
      })
      stagesDispatcher.plan(() =>
        result({
          role: 'planner',
          status: 'ok',
          harness_coverage: MISSING,
          plan: planShape({ prerequisites: [HARNESS_PREREQUISITE] }),
        }),
      )

      await engine.tick()
      await engine.idle()

      const [open] = await openDecisions(task.id)
      assert(open)
      expect(open.options.map((o) => o.id)).toEqual(['proceed', 'cancel'])
      expect(open.promptMd).toContain('Splitting is not offered')
      expect(open.promptMd).toContain(HARNESS_PREREQUISITE.title)
    })

    test('answering split on a task at the depth cap creates nothing — the recursion this closes', async () => {
      const { engine, stagesDispatcher } = makeEngine()
      const { task: origin } = await seed()
      const { task } = await seed({
        at: 'planning',
        originTaskId: origin.id,
        planDepth: 1,
      })
      stagesDispatcher.plan(() =>
        result({ role: 'planner', status: 'ok', harness_coverage: MISSING }),
      )
      await engine.tick()
      await engine.idle()
      const [decision] = await openDecisions(task.id)
      assert(decision)

      // The option list is computed from the task's own depth, so `split` was
      // never offered here. Accepting it anyway would close the card on an
      // action the engine then declines to take, leaving the task past its gate
      // with the gap neither accepted nor recorded.
      await expect(
        engine.answer({
          taskId: task.id,
          decisionId: decision.id,
          actor: 'evgeny',
          optionId: 'split',
        }),
      ).rejects.toThrow(CoverageDecisionRequiresOptionError)

      const after = await reload(db, task.id)
      expect(after.blockedBy).toEqual([])
      expect(after.status).toBe('human_kickoff_gate')
      const spawned = await db.select().from(tasks).where(eq(tasks.originTaskId, task.id))
      expect(spawned).toEqual([])

      const [stillOpen] = await openDecisions(task.id)
      expect(stillOpen?.id).toBe(decision.id)
    })

    test('a plan proposing more than the cap creates the cap and names the rest — AC-637', async () => {
      const { engine, stagesDispatcher } = makeEngine()
      const { task } = await seed({ at: 'planning', caps: { max_prerequisite_tasks: 1 } })
      stagesDispatcher.plan(() =>
        result({
          role: 'planner',
          status: 'ok',
          harness_coverage: ADEQUATE,
          plan: planShape({
            size: 'large',
            prerequisites: [HARNESS_PREREQUISITE, FIXTURE_PREREQUISITE],
          }),
        }),
      )
      await engine.tick()
      await engine.idle()
      const [decision] = await openDecisions(task.id)
      assert(decision)
      expect(decision.promptMd).toContain('one plan may create at most 1')
      expect(decision.promptMd).toContain(FIXTURE_PREREQUISITE.title)

      await engine.answer({
        taskId: task.id,
        decisionId: decision.id,
        actor: 'evgeny',
        optionId: 'split',
      })

      const after = await reload(db, task.id)
      expect(after.blockedBy).toHaveLength(1)
      created.push(...after.blockedBy)
      const [prerequisite] = await db
        .select()
        .from(tasks)
        .where(eq(tasks.id, after.blockedBy[0] as string))
      expect(prerequisite?.title).toBe(HARNESS_PREREQUISITE.title)
    })
  })

  describe('the split', () => {
    test('answering split creates the tasks the plan proposed, carrying their lineage — AC-1411, AC-1421', async () => {
      const { engine, stagesDispatcher } = makeEngine()
      const { task } = await seed({ at: 'planning' })
      stagesDispatcher.plan(() =>
        result({
          role: 'planner',
          status: 'ok',
          harness_coverage: MISSING,
          plan: planShape({ prerequisites: [HARNESS_PREREQUISITE, FIXTURE_PREREQUISITE] }),
        }),
      )
      await engine.tick()
      await engine.idle()
      const [decision] = await openDecisions(task.id)
      assert(decision)

      await engine.answer({
        taskId: task.id,
        decisionId: decision.id,
        actor: 'evgeny',
        optionId: 'split',
      })

      const after = await reload(db, task.id)
      expect(after.status).toBe('blocked')
      expect(after.blockedBy).toHaveLength(2)
      created.push(...after.blockedBy)

      const spawned = await db
        .select()
        .from(tasks)
        .where(inArray(tasks.id, [...after.blockedBy]))
      expect(spawned.map((row) => row.title).sort()).toEqual(
        [HARNESS_PREREQUISITE.title, FIXTURE_PREREQUISITE.title].sort(),
      )
      for (const row of spawned) {
        expect(row.originTaskId).toBe(task.id)
        expect(row.planDepth).toBe(1)
        expect(row.repoUrl).toBe(task.repoUrl)
        expect(row.status).toBe('planning')
      }
    })

    test('answering split with nothing proposed falls back to the harness task carrying the evidence — REQ-1404, AC-1420', async () => {
      const { engine, stagesDispatcher } = makeEngine()
      const { task } = await seed({ at: 'planning' })
      stagesDispatcher.plan(() =>
        result({ role: 'planner', status: 'ok', harness_coverage: MISSING }),
      )
      await engine.tick()
      await engine.idle()
      const [decision] = await openDecisions(task.id)
      assert(decision)

      await engine.answer({
        taskId: task.id,
        decisionId: decision.id,
        actor: 'evgeny',
        optionId: 'split',
      })

      const after = await reload(db, task.id)
      expect(after.status).toBe('blocked')
      expect(after.blockedBy).toHaveLength(1)

      const harnessTaskId = after.blockedBy[0]
      assert(harnessTaskId)
      created.push(harnessTaskId)
      const [harnessTask] = await db.select().from(tasks).where(eq(tasks.id, harnessTaskId))
      assert(harnessTask)
      expect(harnessTask.repoUrl).toBe(task.repoUrl)
      expect(harnessTask.baseBranch).toBe(task.baseBranch)
      expect(harnessTask.status).toBe('planning')
      expect(harnessTask.description).toContain(MISSING.evidence_md)
      expect(harnessTask.originTaskId).toBe(task.id)
      expect(harnessTask.planDepth).toBe(1)

      const [pinnedGraph] = await db
        .select()
        .from(runGraphs)
        .where(eq(runGraphs.taskId, harnessTaskId))
      expect(pinnedGraph).toBeTruthy()
    })
  })

  describe('an accepted gap outlives its task', () => {
    async function inForce(repoUrl: string) {
      return db
        .select()
        .from(coverageWaivers)
        .where(and(eq(coverageWaivers.repoUrl, repoUrl), isNull(coverageWaivers.revokedAt)))
    }

    /** Runs one planning stage against a task and returns it reloaded. */
    async function planned(repoUrl: string, coverage: typeof MISSING | typeof ADEQUATE) {
      const { engine, stagesDispatcher } = makeEngine()
      const { task } = await seed({ at: 'planning', repoUrl })
      stagesDispatcher.plan(() =>
        result({ role: 'planner', status: 'ok', harness_coverage: coverage }),
      )
      await engine.tick()
      await engine.idle()

      return { engine, task: await reload(db, task.id) }
    }

    test('proceeding records the acceptance as a repository waiver — REQ-1406', async () => {
      const repoUrl = `file:///dev/null/shared-${crypto.randomUUID().slice(0, 8)}`
      const { engine, task } = await planned(repoUrl, MISSING)
      const [decision] = await openDecisions(task.id)
      assert(decision)

      await engine.answer({
        taskId: task.id,
        decisionId: decision.id,
        actor: 'evgeny',
        optionId: 'proceed',
      })

      const waivers = await inForce(repoUrl)
      expect(waivers).toHaveLength(1)
      expect(waivers[0]).toMatchObject({ originTaskId: task.id })
    })

    test('proceeding on a card raised only by proposed work accepts no gap — REQ-1403', async () => {
      const repoUrl = `file:///dev/null/shared-${crypto.randomUUID().slice(0, 8)}`
      const { engine, stagesDispatcher } = makeEngine()
      const { task } = await seed({ at: 'planning', repoUrl })
      stagesDispatcher.plan(() =>
        result({
          role: 'planner',
          status: 'ok',
          harness_coverage: ADEQUATE,
          plan: planShape({ prerequisites: [HARNESS_PREREQUISITE] }),
        }),
      )
      await engine.tick()
      await engine.idle()

      const [decision] = await openDecisions(task.id)
      assert(decision)
      await engine.answer({
        taskId: task.id,
        decisionId: decision.id,
        actor: 'evgeny',
        optionId: 'proceed',
      })

      // The card was raised because the plan proposed work, not because
      // coverage was short. "Proceed as one task" declines the split; there is
      // no gap here for it to accept, and none for a later task to inherit.
      expect(await inForce(repoUrl)).toEqual([])
      expect((await reload(db, task.id)).harnessStatus).toBe('adequate')
    })

    test('the next task in that repository inherits it instead of asking — AC-1422, AC-1423', async () => {
      const repoUrl = `file:///dev/null/shared-${crypto.randomUUID().slice(0, 8)}`
      const first = await planned(repoUrl, MISSING)
      const [decision] = await openDecisions(first.task.id)
      assert(decision)
      await first.engine.answer({
        taskId: first.task.id,
        decisionId: decision.id,
        actor: 'evgeny',
        optionId: 'proceed',
      })

      const second = await planned(repoUrl, MISSING)

      expect(second.task.harnessStatus).toBe('waived')
      expect(second.task.status).toBe('human_kickoff_gate')
      expect(await openDecisions(second.task.id)).toEqual([])

      const [inherited] = await db
        .select()
        .from(decisions)
        .where(eq(decisions.taskId, second.task.id))
      expect(inherited).toMatchObject({ key: 'harness-coverage', status: 'answered' })
      expect(inherited?.answerMd).toContain(first.task.title)
    })

    test('an inherited waiver still raises the choice a plan proposes — AC-1424', async () => {
      const repoUrl = `file:///dev/null/shared-${crypto.randomUUID().slice(0, 8)}`
      const first = await planned(repoUrl, MISSING)
      const [decision] = await openDecisions(first.task.id)
      assert(decision)
      await first.engine.answer({
        taskId: first.task.id,
        decisionId: decision.id,
        actor: 'evgeny',
        optionId: 'proceed',
      })

      const { engine, stagesDispatcher } = makeEngine()
      const { task } = await seed({ at: 'planning', repoUrl })
      stagesDispatcher.plan(() =>
        result({
          role: 'planner',
          status: 'ok',
          harness_coverage: MISSING,
          plan: planShape({ prerequisites: [HARNESS_PREREQUISITE] }),
        }),
      )
      await engine.tick()
      await engine.idle()

      expect((await reload(db, task.id)).harnessStatus).toBe('waived')
      const [open] = await openDecisions(task.id)
      assert(open)
      expect(open.promptMd).toContain(HARNESS_PREREQUISITE.title)
      expect(open.promptMd).not.toContain('cannot be properly validated')
    })

    test('an adequate classification ends the acceptance — AC-1425', async () => {
      const repoUrl = `file:///dev/null/shared-${crypto.randomUUID().slice(0, 8)}`
      const first = await planned(repoUrl, MISSING)
      const [decision] = await openDecisions(first.task.id)
      assert(decision)
      await first.engine.answer({
        taskId: first.task.id,
        decisionId: decision.id,
        actor: 'evgeny',
        optionId: 'proceed',
      })
      expect(await inForce(repoUrl)).toHaveLength(1)

      await planned(repoUrl, ADEQUATE)

      expect(await inForce(repoUrl)).toEqual([])
    })

    test('accepting a second time leaves exactly one live record — AC-1427', async () => {
      const repoUrl = `file:///dev/null/shared-${crypto.randomUUID().slice(0, 8)}`
      for (let round = 0; round < 2; round += 1) {
        const { engine, task } = await planned(repoUrl, MISSING)
        const open = await openDecisions(task.id)
        if (open[0]) {
          await engine.answer({
            taskId: task.id,
            decisionId: open[0].id,
            actor: 'evgeny',
            optionId: 'proceed',
          })
        }
      }

      expect(await inForce(repoUrl)).toHaveLength(1)
    })
  })

  describe('waiting and release', () => {
    test('nothing is dispatched for a blocked task under repeated polling — AC-626', async () => {
      const { engine, stagesDispatcher } = makeEngine()
      const { task } = await seed({ status: 'blocked' })

      for (let i = 0; i < 3; i++) {
        await engine.tick()
        await engine.idle()
      }

      expect(stagesDispatcher.dispatches.some((d) => d.task.id === task.id)).toBe(false)
      expect((await reload(db, task.id)).status).toBe('blocked')
    })

    test('releases a dependent only once every blocker lands, re-entering planning and reclassifying — AC-627, AC-628, AC-1412', async () => {
      const { engine, stagesDispatcher } = makeEngine()
      const { task: blocker1 } = await seed({ status: 'human_final_gate' })
      const { task: blocker2 } = await seed({ status: 'human_final_gate' })
      const { task: dependent } = await seed({ status: 'blocked' })
      await db
        .update(tasks)
        .set({ blockedBy: [blocker1.id, blocker2.id] })
        .where(eq(tasks.id, dependent.id))

      await engine.approve(blocker1.id, 'evgeny')
      await engine.tick()
      await engine.idle()

      let after = await reload(db, dependent.id)
      expect(after.status).toBe('blocked')
      expect(after.blockedBy).toEqual([blocker2.id])

      await engine.approve(blocker2.id, 'evgeny')
      await engine.tick()
      await engine.idle()

      after = await reload(db, dependent.id)
      expect(after.status).toBe('planning')
      expect(after.blockedBy).toEqual([])

      stagesDispatcher.plan(() =>
        result({
          role: 'planner',
          status: 'ok',
          harness_coverage: {
            classification: 'adequate',
            evidence_md: 'The harness task added an e2e suite.',
          },
        }),
      )
      await engine.tick()
      await engine.idle()
      expect((await reload(db, dependent.id)).harnessStatus).toBe('adequate')
    })

    test('raises a dependent to the human when its blocker is cancelled, naming it, and resumes into planning once resolved — AC-629', async () => {
      const { engine } = makeEngine()
      const { task: blocker } = await seed({ at: 'specify' })
      const { task: dependent } = await seed({ status: 'blocked' })
      await db
        .update(tasks)
        .set({ blockedBy: [blocker.id] })
        .where(eq(tasks.id, dependent.id))

      await engine.cancel(blocker.id, 'evgeny')

      const after = await reload(db, dependent.id)
      expect(after.status).toBe('waiting_human')
      expect(after.blockedBy).toEqual([])
      expect(after.resumeStatus).toBe('planning')
      const open = await openDecisions(dependent.id)
      expect(open).toHaveLength(1)
      expect(open[0]?.blocking).toBe(true)
      expect(open[0]?.promptMd).toContain(blocker.id)

      const openDecisionId = open[0]?.id
      assert(openDecisionId)
      await engine.dismiss({ taskId: dependent.id, decisionId: openDecisionId, actor: 'evgeny' })

      expect((await reload(db, dependent.id)).status).toBe('planning')
    })

    test('a dead blocker raises the escalation without abandoning the live ones — REQ-615', async () => {
      const { engine } = makeEngine()
      const { task: blocker1 } = await seed({ at: 'specify' })
      const { task: blocker2 } = await seed({ status: 'human_final_gate' })
      const { task: dependent } = await seed({ status: 'blocked' })
      await db
        .update(tasks)
        .set({ blockedBy: [blocker1.id, blocker2.id] })
        .where(eq(tasks.id, dependent.id))

      await engine.cancel(blocker1.id, 'evgeny')

      // Still blocked: blocker2 is live, and leaving `blocked` here would take
      // the dependent out of the only query that ever clears `blockedBy`,
      // stranding a list that names a task nothing can remove from it.
      const afterDeath = await reload(db, dependent.id)
      expect(afterDeath.status).toBe('blocked')
      expect(afterDeath.blockedBy).toEqual([blocker2.id])

      // The last live blocker landing clears the list, but the escalation the
      // dead one raised is still open and blocking, so the dependent goes to
      // the owner rather than into its pipeline.
      await engine.approve(blocker2.id, 'evgeny')
      await engine.tick()
      await engine.idle()
      const afterSurvivorLands = await reload(db, dependent.id)
      expect(afterSurvivorLands.status).toBe('waiting_human')
      expect(afterSurvivorLands.blockedBy).toEqual([])

      const open = await openDecisions(dependent.id)
      const escalation = open.find((d) => d.key === `blocker-lost:${blocker1.id}`)
      assert(escalation)
      await engine.dismiss({ taskId: dependent.id, decisionId: escalation.id, actor: 'evgeny' })

      expect((await reload(db, dependent.id)).status).toBe('planning')
    })
  })
})
