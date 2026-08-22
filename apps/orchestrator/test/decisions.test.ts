import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'
import { renderDecisionLog, StageResult } from '@specmate/core'
import {
  conversationActions,
  conversationMessages,
  conversations,
  createDb,
  type Database,
  decisions,
  events,
  feedback,
  stages,
  tasks,
} from '@specmate/db'
import type { StageExecution } from '@specmate/runner'
import { and, asc, eq, inArray } from 'drizzle-orm'
import {
  DecisionAnswerEmptyError,
  DecisionNotOpenError,
  Engine,
  type EngineSettings,
} from '../src/engine.ts'
import { recordRound } from '../src/store.ts'
import {
  fakeConversationDispatcher,
  fakeDispatcher,
  fakeWorkspaces,
  reload,
  seedTask,
} from './fixtures.ts'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

/** Every fixture planner result needs one once it reaches `ok` — REQ-110 makes silence invalid. */
const FIXTURE_HARNESS_COVERAGE = {
  classification: 'adequate' as const,
  evidence_md: 'Fixture: an existing e2e suite covers this path.',
}

function result(overrides: Partial<StageResult> & { role: StageResult['role'] }): StageExecution {
  const needsCoverage = overrides.role === 'planner' && (overrides.status ?? 'ok') === 'ok'

  return {
    status: 'succeeded',
    attempts: [{ attempt: 0, ok: true, durationMs: 5 }],
    result: StageResult.parse({
      schema_version: 1,
      status: 'ok',
      // A planning role's ok result must carry both (AC-1317); an override still wins.
      ...(needsCoverage
        ? {
            harness_coverage: FIXTURE_HARNESS_COVERAGE,
            plan: { size: 'medium' as const, prerequisites: [] },
          }
        : {}),
      ...overrides,
    }),
    telemetry: { model: 'stub-model-1', tokens: null, costUsd: null, raw: null },
  }
}

describeDb('decision-records', () => {
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
    const conversationsDispatcher = fakeConversationDispatcher()
    const logs: string[] = []
    const engine = new Engine({
      db,
      workspaces: ws.workspaces,
      settings: {
        stageConcurrency: 1,
        stageAttemptCap: 2,
        conversationConcurrency: 1,
        availableProviders: ['claude-code'],
        ...overrides,
      },
      dispatcher: stagesDispatcher.dispatcher,
      conversationDispatcher: conversationsDispatcher.dispatcher,
      log: (message) => logs.push(message),
    })
    engines.push(engine)

    return { engine, ws, stagesDispatcher, conversationsDispatcher, logs }
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

  async function eventTypes(taskId: string): Promise<string[]> {
    const rows = await db
      .select({ type: events.type })
      .from(events)
      .where(eq(events.taskId, taskId))
      .orderBy(asc(events.seq))

    return rows.map((row) => row.type)
  }

  test('the decision log is regenerated before every dispatch, even an empty one — an agent must never see a stale or scribbled copy', async () => {
    const { engine, ws, stagesDispatcher } = makeEngine()
    const { task } = await seed({ at: 'research' })
    stagesDispatcher.plan(() =>
      result({
        role: 'researcher',
        status: 'ok',
        decisions_needed: [{ key: 'style-nit', prompt_md: 'Worth a follow-up?', blocking: false }],
      }),
    )

    await engine.tick()
    await engine.idle()

    // Nothing was open yet when this dispatch's pre-check ran, so the first
    // write is the empty placeholder, not the decision this stage goes on
    // to raise.
    const first = ws.calls.decisionLogs.filter((entry) => entry.slug === task.slug)
    expect(first).toHaveLength(1)
    expect(first[0]?.markdown).toContain('No decisions have been raised')
    expect((await reload(db, task.id)).status).toBe('spec_review')

    stagesDispatcher.plan(() => result({ role: 'reviewer', status: 'ok', verdict: 'approve' }))
    await engine.tick()
    await engine.idle()

    const written = ws.calls.decisionLogs.filter((entry) => entry.slug === task.slug)
    expect(written).toHaveLength(2)
    expect(written[1]?.markdown).toContain('Worth a follow-up?')
  })

  test('a blocking request parks the task, records waiting_human on the stage, and keeps the committed result', async () => {
    const { engine, stagesDispatcher } = makeEngine()
    const { task } = await seed({ at: 'research' })
    stagesDispatcher.plan(() =>
      result({
        role: 'researcher',
        status: 'needs_decision',
        decisions_needed: [{ key: 'scope', prompt_md: 'What does this cover?' }],
      }),
    )

    await engine.tick()
    await engine.idle()

    expect((await reload(db, task.id)).status).toBe('waiting_human')
    const [stage] = await db.select().from(stages).where(eq(stages.taskId, task.id))
    expect(stage).toMatchObject({ status: 'waiting_human' })
    expect(stage?.result).toMatchObject({ status: 'needs_decision' })
    const open = await openDecisions(task.id)
    expect(open).toHaveLength(1)
    expect(open[0]).toMatchObject({
      nodeKey: 'research',
      key: 'scope',
      blocking: true,
      status: 'open',
    })
  })

  test('a non-blocking request is recorded without parking the task', async () => {
    const { engine, stagesDispatcher } = makeEngine()
    const { task } = await seed({ at: 'research' })
    stagesDispatcher.plan(() =>
      result({
        role: 'researcher',
        status: 'ok',
        decisions_needed: [{ key: 'style-nit', prompt_md: 'Worth a follow-up?', blocking: false }],
      }),
    )

    await engine.tick()
    await engine.idle()

    expect((await reload(db, task.id)).status).toBe('spec_review')
    const open = await openDecisions(task.id)
    expect(open).toHaveLength(1)
    expect(open[0]).toMatchObject({ blocking: false, status: 'open' })
  })

  test('an ok status carrying a blocking decision still parks the task, not just needs_decision', async () => {
    const { engine, stagesDispatcher } = makeEngine()
    const { task } = await seed({ at: 'research' })
    stagesDispatcher.plan(() =>
      result({
        role: 'researcher',
        status: 'ok',
        decisions_needed: [{ key: 'scope', prompt_md: 'Which repo?', blocking: true }],
      }),
    )

    await engine.tick()
    await engine.idle()

    expect((await reload(db, task.id)).status).toBe('waiting_human')
    const open = await openDecisions(task.id)
    expect(open).toHaveLength(1)
    expect(open[0]).toMatchObject({ blocking: true, status: 'open' })
  })

  test('escalate, cap_exhausted, and repeated_finding each leave exactly one open escalation', async () => {
    const { engine: escalateEngine, stagesDispatcher: escalateDispatcher } = makeEngine()
    const escalate = await seed({ at: 'spec_review' })
    escalateDispatcher.plan(() => result({ role: 'reviewer', verdict: 'escalate', findings: [] }))
    await escalateEngine.tick()
    await escalateEngine.idle()
    expect((await reload(db, escalate.task.id)).status).toBe('waiting_human')
    const escalateOpen = await openDecisions(escalate.task.id)
    expect(escalateOpen.filter((d) => d.kind === 'escalation')).toHaveLength(1)
    expect(escalateOpen[0]?.promptMd).toContain('escalate')

    const { engine: capEngine, stagesDispatcher: capDispatcher } = makeEngine()
    const cap = await seed({ at: 'spec_review' })
    for (const round of [1, 2, 3]) {
      await recordRound(db, cap.task.id, { loop: 'spec', round, verdict: 'revise', findings: [] })
    }
    capDispatcher.plan(() => result({ role: 'reviewer', verdict: 'revise', findings: [] }))
    await capEngine.tick()
    await capEngine.idle()
    expect((await reload(db, cap.task.id)).status).toBe('waiting_human')
    const capOpen = await openDecisions(cap.task.id)
    expect(capOpen.filter((d) => d.kind === 'escalation')).toHaveLength(1)
    expect(capOpen[0]?.promptMd).toContain('spec')

    const { engine: repeatEngine, stagesDispatcher: repeatDispatcher } = makeEngine()
    const repeat = await seed({ at: 'spec_review' })
    await recordRound(db, repeat.task.id, {
      loop: 'spec',
      round: 1,
      verdict: 'revise',
      findings: [{ id: 'stubborn', severity: 'major', title: 'Still wrong', detail_md: '' }],
    })
    repeatDispatcher.plan(() =>
      result({
        role: 'reviewer',
        verdict: 'revise',
        findings: [{ id: 'stubborn', severity: 'major', title: 'Still wrong', detail_md: '' }],
      }),
    )
    await repeatEngine.tick()
    await repeatEngine.idle()
    expect((await reload(db, repeat.task.id)).status).toBe('waiting_human')
    const repeatOpen = await openDecisions(repeat.task.id)
    expect(repeatOpen.filter((d) => d.kind === 'escalation')).toHaveLength(1)
    expect(repeatOpen[0]?.promptMd).toContain('stubborn')
  })

  test('raising a decision creates exactly one conversation and dispatches no response before an owner message', async () => {
    const { engine, stagesDispatcher, conversationsDispatcher } = makeEngine()
    const { task } = await seed({ at: 'research' })
    stagesDispatcher.plan(() =>
      result({
        role: 'researcher',
        status: 'needs_decision',
        decisions_needed: [{ key: 'scope', prompt_md: 'What does this cover?' }],
      }),
    )

    await engine.tick()
    await engine.idle()

    const [decision] = await openDecisions(task.id)
    assert(decision)
    const convos = await db
      .select()
      .from(conversations)
      .where(
        and(eq(conversations.subjectKind, 'decision'), eq(conversations.subjectId, decision.id)),
      )
    expect(convos).toHaveLength(1)

    expect(await engine.tick()).toBe(0)
    expect(conversationsDispatcher.dispatches).toHaveLength(0)
  })

  test('answering the last of two blocking decisions resumes the task and records feedback against the asking stage', async () => {
    const { engine, stagesDispatcher } = makeEngine()
    const { task } = await seed({ at: 'research' })
    stagesDispatcher.plan(() =>
      result({
        role: 'researcher',
        status: 'needs_decision',
        decisions_needed: [
          { key: 'scope', prompt_md: 'What does this cover?' },
          { key: 'owner', prompt_md: 'Who owns this?' },
        ],
      }),
    )
    await engine.tick()
    await engine.idle()
    const open = await openDecisions(task.id)
    expect(open).toHaveLength(2)
    const scope = open.find((d) => d.key === 'scope')
    const owner = open.find((d) => d.key === 'owner')
    assert(scope && owner)

    const afterFirst = await engine.answer({
      taskId: task.id,
      decisionId: scope.id,
      actor: 'evgeny',
      text: 'The whole repo.',
    })
    expect(afterFirst.status).toBe('waiting_human')
    expect((await reload(db, task.id)).status).toBe('waiting_human')

    const afterSecond = await engine.answer({
      taskId: task.id,
      decisionId: owner.id,
      actor: 'evgeny',
      text: 'The platform team.',
    })
    expect(afterSecond.status).toBe('research')
    expect((await reload(db, task.id)).status).toBe('research')

    const feedbackRows = await db
      .select()
      .from(feedback)
      .where(and(eq(feedback.taskId, task.id), eq(feedback.kind, 'decision_answer')))
    expect(feedbackRows).toHaveLength(2)
    for (const row of feedbackRows) {
      expect(row.role).toBe('researcher')
      expect(row.provider).toBe('claude-code')
    }
  })

  test('answering with an option id stores the option label, not the id', async () => {
    const { engine, stagesDispatcher } = makeEngine()
    const { task } = await seed({ at: 'research' })
    stagesDispatcher.plan(() =>
      result({
        role: 'researcher',
        status: 'needs_decision',
        decisions_needed: [
          {
            key: 'scope',
            prompt_md: 'Which repo?',
            options: [
              { id: 'opt-whole', label: 'The whole repository' },
              { id: 'opt-frontend', label: 'Frontend only' },
            ],
          },
        ],
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
      optionId: 'opt-frontend',
    })

    const stored = (await db.select().from(decisions).where(eq(decisions.id, decision.id)))[0]
    expect(stored?.answerMd).toBe('Frontend only')
  })

  test('resolving the last blocking decision emits task.resumed alongside decision.answered', async () => {
    const { engine, stagesDispatcher } = makeEngine()
    const { task } = await seed({ at: 'research' })
    stagesDispatcher.plan(() =>
      result({
        role: 'researcher',
        status: 'needs_decision',
        decisions_needed: [{ key: 'scope', prompt_md: 'What does this cover?' }],
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
      text: 'The whole repo.',
    })

    expect(await eventTypes(task.id)).toContain('task.resumed')
  })

  test('resolving twice, and answering with neither an option nor text, are rejected without writing anything', async () => {
    const { engine, stagesDispatcher } = makeEngine()
    const { task } = await seed({ at: 'research' })
    stagesDispatcher.plan(() =>
      result({
        role: 'researcher',
        status: 'needs_decision',
        decisions_needed: [{ key: 'scope', prompt_md: 'What does this cover?' }],
      }),
    )
    await engine.tick()
    await engine.idle()
    const [decision] = await openDecisions(task.id)
    assert(decision)

    await expect(
      engine.answer({ taskId: task.id, decisionId: decision.id, actor: 'evgeny' }),
    ).rejects.toThrow(DecisionAnswerEmptyError)
    expect(
      (await db.select().from(decisions).where(eq(decisions.id, decision.id)))[0]?.status,
    ).toBe('open')

    await engine.answer({
      taskId: task.id,
      decisionId: decision.id,
      actor: 'evgeny',
      text: 'Fine.',
    })
    await expect(
      engine.answer({ taskId: task.id, decisionId: decision.id, actor: 'evgeny', text: 'Again?' }),
    ).rejects.toThrow(DecisionNotOpenError)
    const stored = (await db.select().from(decisions).where(eq(decisions.id, decision.id)))[0]
    expect(stored?.answerMd).toBe('Fine.')
  })

  test('dismissing the last blocker resumes the task and reads as dismissed, not answered', async () => {
    const { engine, stagesDispatcher } = makeEngine()
    const { task } = await seed({ at: 'research' })
    stagesDispatcher.plan(() =>
      result({
        role: 'researcher',
        status: 'needs_decision',
        decisions_needed: [{ key: 'scope', prompt_md: 'What does this cover?' }],
      }),
    )
    await engine.tick()
    await engine.idle()
    const [decision] = await openDecisions(task.id)
    assert(decision)

    const resumed = await engine.dismiss({
      taskId: task.id,
      decisionId: decision.id,
      actor: 'evgeny',
      reason: 'Superseded.',
    })

    expect(resumed.status).toBe('research')
    const stored = (await db.select().from(decisions).where(eq(decisions.id, decision.id)))[0]
    expect(stored).toMatchObject({ status: 'dismissed', answerMd: 'Superseded.' })
  })

  test('cancelling a task with open decisions dismisses them', async () => {
    const { engine, stagesDispatcher } = makeEngine()
    const { task } = await seed({ at: 'research' })
    stagesDispatcher.plan(() =>
      result({
        role: 'researcher',
        status: 'needs_decision',
        decisions_needed: [{ key: 'scope', prompt_md: 'What does this cover?' }],
      }),
    )
    await engine.tick()
    await engine.idle()
    expect(await openDecisions(task.id)).toHaveLength(1)

    await engine.cancel(task.id, 'evgeny')

    expect((await reload(db, task.id)).status).toBe('cancelled')
    expect(await openDecisions(task.id)).toHaveLength(0)
    const [decision] = await db.select().from(decisions).where(eq(decisions.taskId, task.id))
    expect(decision).toMatchObject({ status: 'dismissed', answeredBy: 'evgeny' })
  })

  test('sweep logs a waiting_human task with no open decision as a defect, without repairing it', async () => {
    const { engine, logs } = makeEngine()
    const { task } = await seed({ at: 'research', status: 'waiting_human', resume: 'research' })

    await engine.sweep()

    expect((await reload(db, task.id)).status).toBe('waiting_human')
    expect(logs.some((line) => line.includes(task.id) && line.includes('defect'))).toBe(true)
  })

  test('a confirmed answer_decision action delegates to the same answer operation; a stale one conflicts', async () => {
    const { engine, stagesDispatcher } = makeEngine()
    const { task, graph } = await seed({ at: 'research' })
    stagesDispatcher.plan(() =>
      result({
        role: 'researcher',
        status: 'needs_decision',
        decisions_needed: [{ key: 'scope', prompt_md: 'What does this cover?' }],
      }),
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
    const [message] = await db
      .insert(conversationMessages)
      .values({
        conversationId: conversation.id,
        sequence: 1,
        role: 'assistant',
        contentMd: 'I recommend answering "the whole repo".',
        status: 'completed',
        taskState: 'waiting_human',
      })
      .returning()
    assert(message)
    const [action] = await db
      .insert(conversationActions)
      .values({
        taskId: task.id,
        conversationId: conversation.id,
        messageId: message.id,
        kind: 'answer_decision',
        target: { taskId: task.id, graphId: graph.id, decisionId: decision.id },
        instruction: 'The whole repo.',
        expectedVersion: { taskStatus: 'waiting_human', graphId: graph.id, decisionStatus: 'open' },
      })
      .returning()
    assert(action)

    // Proposing the action does not itself resolve anything.
    expect(
      (await db.select().from(decisions).where(eq(decisions.id, decision.id)))[0]?.status,
    ).toBe('open')

    await engine.confirmAction({
      taskId: task.id,
      actionId: action.id,
      actor: 'evgeny',
      idempotencyKey: `confirm:${action.id}`,
    })

    const resolved = (await db.select().from(decisions).where(eq(decisions.id, decision.id)))[0]
    expect(resolved).toMatchObject({ status: 'answered', answerMd: 'The whole repo.' })
    expect((await reload(db, task.id)).status).toBe('research')

    // A second proposal against the now-resolved decision is a stale target.
    const [staleMessage] = await db
      .insert(conversationMessages)
      .values({
        conversationId: conversation.id,
        sequence: 2,
        role: 'assistant',
        contentMd: 'A later, stale proposal.',
        status: 'completed',
        taskState: 'research',
      })
      .returning()
    assert(staleMessage)
    const [staleAction] = await db
      .insert(conversationActions)
      .values({
        taskId: task.id,
        conversationId: conversation.id,
        messageId: staleMessage.id,
        kind: 'answer_decision',
        target: { taskId: task.id, graphId: graph.id, decisionId: decision.id },
        instruction: 'Something else.',
        expectedVersion: { taskStatus: 'waiting_human', graphId: graph.id, decisionStatus: 'open' },
      })
      .returning()
    assert(staleAction)

    await expect(
      engine.confirmAction({
        taskId: task.id,
        actionId: staleAction.id,
        actor: 'evgeny',
        idempotencyKey: `confirm:${staleAction.id}`,
      }),
    ).rejects.toThrow()
    const stillResolved = (
      await db.select().from(decisions).where(eq(decisions.id, decision.id))
    )[0]
    expect(stillResolved?.answerMd).toBe('The whole repo.')
  })

  test('answer_decision on a non-blocking decision still applies after the task has advanced past it', async () => {
    const { engine, stagesDispatcher } = makeEngine()
    const { task, graph } = await seed({ at: 'research' })
    stagesDispatcher.plan(() =>
      result({
        role: 'researcher',
        status: 'ok',
        decisions_needed: [{ key: 'style-nit', prompt_md: 'Worth a follow-up?', blocking: false }],
      }),
    )
    await engine.tick()
    await engine.idle()

    // AC-1206: the task advances past research even though the non-blocking
    // decision it raised is still open.
    expect((await reload(db, task.id)).status).toBe('spec_review')
    const [decision] = await openDecisions(task.id)
    assert(decision)

    const [conversation] = await db
      .select()
      .from(conversations)
      .where(
        and(eq(conversations.subjectKind, 'decision'), eq(conversations.subjectId, decision.id)),
      )
    assert(conversation)
    const [message] = await db
      .insert(conversationMessages)
      .values({
        conversationId: conversation.id,
        sequence: 1,
        role: 'assistant',
        contentMd: 'Worth filing separately.',
        status: 'completed',
        taskState: 'research',
      })
      .returning()
    assert(message)
    const [action] = await db
      .insert(conversationActions)
      .values({
        taskId: task.id,
        conversationId: conversation.id,
        messageId: message.id,
        kind: 'answer_decision',
        target: { taskId: task.id, graphId: graph.id, decisionId: decision.id },
        instruction: 'Yes, file it separately.',
        // Snapshotted while the task was still at research — stale by the
        // time this gets confirmed, since a non-blocking decision does not
        // pin the task's status while it stays open.
        expectedVersion: { taskStatus: 'research', graphId: graph.id, decisionStatus: 'open' },
      })
      .returning()
    assert(action)

    await engine.confirmAction({
      taskId: task.id,
      actionId: action.id,
      actor: 'evgeny',
      idempotencyKey: `confirm:${action.id}`,
    })

    const resolved = (await db.select().from(decisions).where(eq(decisions.id, decision.id)))[0]
    expect(resolved).toMatchObject({ status: 'answered', answerMd: 'Yes, file it separately.' })
    expect((await reload(db, task.id)).status).toBe('spec_review')
  })
})

describeDb('kickoff brief questions', () => {
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
    const conversationsDispatcher = fakeConversationDispatcher()
    const engine = new Engine({
      db,
      workspaces: ws.workspaces,
      settings: {
        stageConcurrency: 1,
        stageAttemptCap: 2,
        conversationConcurrency: 1,
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

  const BRIEF_QUESTIONS: StageResult['decisions_needed'] = [
    { key: 'auth-scope', kind: 'question', prompt_md: 'Mobile too?', options: [], blocking: false },
    {
      key: 'data-retention',
      kind: 'question',
      prompt_md: 'Revoke immediately?',
      options: [],
      blocking: false,
    },
  ]

  test('a brief stage returning non-blocking questions advances to the gate carrying them open — REQ-1304, AC-1309', async () => {
    const { engine, stagesDispatcher } = makeEngine()
    const { task } = await seed({ at: 'kickoff_brief' })
    stagesDispatcher.plan(() =>
      result({ role: 'planner', status: 'ok', decisions_needed: BRIEF_QUESTIONS }),
    )

    await engine.tick()
    await engine.idle()

    expect((await reload(db, task.id)).status).toBe('human_kickoff_gate')
    const open = await openDecisions(task.id)
    expect(open.map((d) => d.key).sort()).toEqual(['auth-scope', 'data-retention'])
    expect(open.every((d) => d.blocking === false && d.nodeKey === 'kickoff_brief')).toBe(true)
  })

  test('questions past the cap are refused, and the event names them — REQ-1208, AC-1225', async () => {
    const { engine, stagesDispatcher } = makeEngine()
    const { task } = await seed({ at: 'kickoff_brief', caps: { max_questions_per_stage: 2 } })
    stagesDispatcher.plan(() =>
      result({
        role: 'planner',
        status: 'ok',
        decisions_needed: [
          ...BRIEF_QUESTIONS,
          { key: 'rollout', kind: 'question', prompt_md: 'Staged?', options: [], blocking: false },
          { key: 'metrics', kind: 'question', prompt_md: 'Which?', options: [], blocking: false },
        ],
      }),
    )

    await engine.tick()
    await engine.idle()

    const open = await openDecisions(task.id)
    expect(open.map((d) => d.key).sort()).toEqual(['auth-scope', 'data-retention'])

    const [refused] = await db
      .select()
      .from(events)
      .where(and(eq(events.taskId, task.id), eq(events.type, 'decision.refused')))
    expect(refused?.payload).toMatchObject({ cap: 2, keys: ['rollout', 'metrics'] })
  })

  test('a non-blocking request of another kind is capped too — AC-1229', async () => {
    const { engine, stagesDispatcher } = makeEngine()
    const { task } = await seed({ at: 'kickoff_brief', caps: { max_questions_per_stage: 1 } })
    stagesDispatcher.plan(() =>
      result({
        role: 'planner',
        status: 'ok',
        decisions_needed: [
          { key: 'scope', kind: 'approval', prompt_md: 'Sign off?', options: [], blocking: false },
          { key: 'rollout', kind: 'approval', prompt_md: 'Staged?', options: [], blocking: false },
          { key: 'metrics', kind: 'rework', prompt_md: 'Which?', options: [], blocking: false },
        ],
      }),
    )

    await engine.tick()
    await engine.idle()

    // `kind` is a field the agent writes: a floor it can step over by calling a
    // question an approval is not a floor.
    const open = await openDecisions(task.id)
    expect(open.map((d) => d.key)).toEqual(['scope'])

    const [refused] = await db
      .select()
      .from(events)
      .where(and(eq(events.taskId, task.id), eq(events.type, 'decision.refused')))
    expect(refused?.payload).toMatchObject({ cap: 1, keys: ['rollout', 'metrics'] })
  })

  test('a blocking request is never refused by the question cap — AC-1226', async () => {
    const { engine, stagesDispatcher } = makeEngine()
    const { task } = await seed({ at: 'kickoff_brief', caps: { max_questions_per_stage: 1 } })
    stagesDispatcher.plan(() =>
      result({
        role: 'planner',
        status: 'needs_decision',
        decisions_needed: [
          ...BRIEF_QUESTIONS,
          {
            key: 'unplaceable',
            kind: 'question',
            prompt_md: 'Where does this belong?',
            options: [],
            blocking: true,
          },
        ],
      }),
    )

    await engine.tick()
    await engine.idle()

    const open = await openDecisions(task.id)
    expect(open.map((d) => d.key).sort()).toEqual(['auth-scope', 'unplaceable'])
    expect((await reload(db, task.id)).status).toBe('waiting_human')
  })

  test('one question asked at two nodes is one decision — REQ-1202, AC-1228', async () => {
    const { engine, stagesDispatcher } = makeEngine()
    const { task } = await seed({ at: 'planning' })
    stagesDispatcher.plan((dispatch) =>
      result({
        role: 'planner',
        status: 'ok',
        decisions_needed: [
          {
            key: 'auth-scope',
            kind: 'question',
            prompt_md: `Mobile too? (asked at ${dispatch.node.key})`,
            options: [],
            blocking: false,
          },
        ],
      }),
    )

    await engine.tick()
    await engine.idle()
    expect((await reload(db, task.id)).status).toBe('kickoff_brief')

    await engine.tick()
    await engine.idle()
    expect((await reload(db, task.id)).status).toBe('human_kickoff_gate')

    const open = await openDecisions(task.id)
    expect(open).toHaveLength(1)
    expect(open[0]?.nodeKey).toBe('planning')
    expect(open[0]?.promptMd).toContain('asked at kickoff_brief')
  })

  test('approving the gate resolves every question the brief raised: an answer stands, the rest are dismissed as declined — AC-1310, AC-1311', async () => {
    const { engine, stagesDispatcher } = makeEngine()
    const { task } = await seed({ at: 'kickoff_brief' })
    stagesDispatcher.plan(() =>
      result({ role: 'planner', status: 'ok', decisions_needed: BRIEF_QUESTIONS }),
    )
    await engine.tick()
    await engine.idle()
    const open = await openDecisions(task.id)
    const authScope = open.find((d) => d.key === 'auth-scope')
    assert(authScope)

    await engine.answer({
      taskId: task.id,
      decisionId: authScope.id,
      actor: 'evgeny',
      text: 'Mobile too.',
    })
    await engine.approve(task.id, 'evgeny')

    expect((await reload(db, task.id)).status).toBe('research')
    const all = await db
      .select()
      .from(decisions)
      .where(eq(decisions.taskId, task.id))
      .orderBy(asc(decisions.key))
    expect(all.find((d) => d.key === 'auth-scope')).toMatchObject({
      status: 'answered',
      answerMd: 'Mobile too.',
    })
    expect(all.find((d) => d.key === 'data-retention')).toMatchObject({ status: 'dismissed' })

    const log = renderDecisionLog(all)
    expect(log).toContain('Status: answered by evgeny')
    expect(log).toContain('Mobile too.')
    expect(log).toContain('Status: dismissed by evgeny')
  })

  test('research reads both the answer and the decline once approval resolves the brief’s questions — AC-1310, AC-1311', async () => {
    const { engine, stagesDispatcher, ws } = makeEngine()
    const { task } = await seed({ at: 'kickoff_brief' })
    stagesDispatcher.plan(() =>
      result({ role: 'planner', status: 'ok', decisions_needed: BRIEF_QUESTIONS }),
    )
    await engine.tick()
    await engine.idle()
    const open = await openDecisions(task.id)
    const authScope = open.find((d) => d.key === 'auth-scope')
    assert(authScope)
    await engine.answer({
      taskId: task.id,
      decisionId: authScope.id,
      actor: 'evgeny',
      text: 'Mobile too.',
    })
    await engine.approve(task.id, 'evgeny')

    stagesDispatcher.plan(() => result({ role: 'researcher', status: 'ok' }))
    await engine.tick()
    await engine.idle()

    const logs = ws.calls.decisionLogs.filter((entry) => entry.slug === task.slug)
    const last = logs.at(-1)
    expect(last?.markdown).toContain('Mobile too.')
    expect(last?.markdown).toContain('Status: dismissed by evgeny')
  })

  test('approving the final gate dismisses open decisions as gate_approved before publish', async () => {
    const { engine } = makeEngine()
    const { task } = await seed({ status: 'human_final_gate' })
    await db.insert(decisions).values({
      taskId: task.id,
      nodeKey: 'human_final_gate',
      key: 'final-note',
      kind: 'question',
      promptMd: 'Anything else before archiving?',
      blocking: false,
      status: 'open',
    })

    await engine.approve(task.id, 'evgeny')

    expect((await reload(db, task.id)).status).toBe('publish')
    const all = await db.select().from(decisions).where(eq(decisions.taskId, task.id))
    expect(all).toMatchObject([{ status: 'dismissed' }])

    const dismissals = await db
      .select()
      .from(events)
      .where(and(eq(events.taskId, task.id), eq(events.type, 'decision.dismissed')))
    expect(dismissals).toHaveLength(1)
    expect(dismissals[0]?.payload).toMatchObject({ cause: 'gate_approved' })
  })

  test('a brief question opens its own scoped conversation; a follow-up message and a proposed answer stay inert until confirmed — REQ-1304, AC-1315', async () => {
    const { engine, stagesDispatcher } = makeEngine()
    const { task, graph } = await seed({ at: 'kickoff_brief' })
    stagesDispatcher.plan(() =>
      result({
        role: 'planner',
        status: 'ok',
        decisions_needed: [
          {
            key: 'auth-scope',
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
        contentMd: 'Do you mean the native app, or the mobile web client too?',
        status: 'completed',
        taskState: 'human_kickoff_gate',
      })
      .returning()
    assert(followUp)

    // A follow-up message alone leaves the decision open.
    expect(
      (await db.select().from(decisions).where(eq(decisions.id, decision.id)))[0]?.status,
    ).toBe('open')

    const [proposalMessage] = await db
      .insert(conversationMessages)
      .values({
        conversationId: conversation.id,
        sequence: 2,
        role: 'assistant',
        contentMd: 'I recommend covering mobile too.',
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
        instruction: 'Mobile too.',
        expectedVersion: {
          taskStatus: 'human_kickoff_gate',
          graphId: graph.id,
          decisionStatus: 'open',
        },
      })
      .returning()
    assert(action)

    // A proposed answer does not resolve anything until the owner confirms it.
    expect(
      (await db.select().from(decisions).where(eq(decisions.id, decision.id)))[0]?.status,
    ).toBe('open')

    await engine.confirmAction({
      taskId: task.id,
      actionId: action.id,
      actor: 'evgeny',
      idempotencyKey: `confirm:${action.id}`,
    })

    expect(
      (await db.select().from(decisions).where(eq(decisions.id, decision.id)))[0],
    ).toMatchObject({ status: 'answered', answerMd: 'Mobile too.' })
  })
})
