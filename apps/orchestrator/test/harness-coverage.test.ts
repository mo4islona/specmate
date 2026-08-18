import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'
import { StageResult } from '@specmate/core'
import {
  conversationActions,
  conversationMessages,
  conversations,
  createDb,
  type Database,
  decisions,
  runGraphs,
  tasks,
} from '@specmate/db'
import type { StageExecution } from '@specmate/runner'
import { and, eq, inArray } from 'drizzle-orm'
import { CoverageDecisionRequiresOptionError, Engine, type EngineSettings } from '../src/engine.ts'
import { assertNotSelfDependency, SelfDependencyError } from '../src/store.ts'
import { fakeDispatcher, fakeWorkspaces, reload, seedTask } from './fixtures.ts'

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
  return {
    status: 'succeeded',
    attempts: [{ attempt: 0, ok: true, durationMs: 5 }],
    result: StageResult.parse({ schema_version: 1, status: 'ok', ...overrides }),
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

describeDb('harness-coverage', () => {
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
      log: (message) => logs.push(message),
    })
    engines.push(engine)

    return { engine, ws, stagesDispatcher, logs }
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
      expect(after.status).toBe('kickoff_brief')
      expect(after.harnessStatus).toBe('missing')
    })
  })

  describe('the coverage decision', () => {
    test('a short-of-adequate classification reaches the gate carrying an open decision with all three options — REQ-1403, AC-1407', async () => {
      const { engine, stagesDispatcher } = makeEngine()
      const { task } = await seed({ at: 'kickoff_brief' })
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
      const { task } = await seed({ at: 'kickoff_brief' })
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
      const { task } = await seed({ at: 'kickoff_brief' })
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

      stagesDispatcher.plan(() => result({ role: 'researcher', status: 'ok' }))
      await engine.approve(task.id, 'evgeny')
      expect((await reload(db, task.id)).status).toBe('research')

      await engine.tick()
      await engine.idle()
      expect(stagesDispatcher.dispatches.some((d) => d.node.key === 'research')).toBe(true)
    })

    test('approving with the coverage decision unanswered records the waiver as the decision resolves — REQ-1403, AC-1409', async () => {
      const { engine, stagesDispatcher } = makeEngine()
      const { task } = await seed({ at: 'kickoff_brief' })
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
      expect(after.status).toBe('research')
      expect(
        (await db.select().from(decisions).where(eq(decisions.id, decision.id)))[0],
      ).toMatchObject({ status: 'answered', answerMd: 'Proceed without it' })
    })

    test('dismissing the coverage decision is refused — it has no dismissal to fall back to', async () => {
      const { engine, stagesDispatcher } = makeEngine()
      const { task } = await seed({ at: 'kickoff_brief' })
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
      const { task } = await seed({ at: 'kickoff_brief' })
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
      const { task, graph } = await seed({ at: 'kickoff_brief' })
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

  describe('the split', () => {
    test('answering split creates a harness task carrying the evidence, and blocks the original — REQ-1404, AC-1411', async () => {
      const { engine, stagesDispatcher } = makeEngine()
      const { task } = await seed({ at: 'kickoff_brief' })
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
      expect(harnessTask.status).toBe('draft')
      expect(harnessTask.description).toContain(MISSING.evidence_md)

      const [pinnedGraph] = await db
        .select()
        .from(runGraphs)
        .where(eq(runGraphs.taskId, harnessTaskId))
      expect(pinnedGraph).toBeTruthy()
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

      let after = await reload(db, dependent.id)
      expect(after.status).toBe('blocked')
      expect(after.blockedBy).toEqual([blocker2.id])

      await engine.approve(blocker2.id, 'evgeny')

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
      const { task: blocker } = await seed({ at: 'research' })
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

    test('a second live blocker survives the first one dying, and resolving the escalation still releases the dependent — REQ-615', async () => {
      const { engine } = makeEngine()
      const { task: blocker1 } = await seed({ at: 'research' })
      const { task: blocker2 } = await seed({ status: 'human_final_gate' })
      const { task: dependent } = await seed({ status: 'blocked' })
      await db
        .update(tasks)
        .set({ blockedBy: [blocker1.id, blocker2.id] })
        .where(eq(tasks.id, dependent.id))

      await engine.cancel(blocker1.id, 'evgeny')

      const afterDeath = await reload(db, dependent.id)
      expect(afterDeath.status).toBe('waiting_human')
      expect(afterDeath.blockedBy).toEqual([blocker2.id])

      // blocker2 landing while the dependent is parked on the escalation must
      // not crash or corrupt blockedBy — the dependent already left 'blocked'
      // and has nothing left to react to blocker2's own completion with.
      await engine.approve(blocker2.id, 'evgeny')
      const afterSurvivorLands = await reload(db, dependent.id)
      expect(afterSurvivorLands.status).toBe('waiting_human')
      expect(afterSurvivorLands.blockedBy).toEqual([blocker2.id])

      const open = await openDecisions(dependent.id)
      const escalation = open.find((d) => d.key === `blocker-lost:${blocker1.id}`)
      assert(escalation)
      await engine.dismiss({ taskId: dependent.id, decisionId: escalation.id, actor: 'evgeny' })

      expect((await reload(db, dependent.id)).status).toBe('planning')
    })
  })
})
