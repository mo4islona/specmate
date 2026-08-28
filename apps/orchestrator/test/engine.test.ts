import { afterAll, afterEach, beforeAll, describe, expect, it, test } from 'bun:test'
import assert from 'node:assert/strict'
import { appendOwnerMessage, openConversation } from '@specmate/core'
import {
  conversationActions,
  conversationMessages,
  conversations,
  createConversationStore,
  createDb,
  type Database,
  decisions,
  events,
  feedback,
  iterations,
  stages,
  tasks,
} from '@specmate/db'
import type { ConversationExecution, StageExecution } from '@specmate/runner'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import {
  Engine,
  type EngineSettings,
  NotAtGateError,
  NotParkedError,
  NotRestartableError,
  RedirectCapExhaustedError,
  RestartTargetError,
  ReworkTargetError,
  SkippedTargetError,
  StageStopConflictError,
} from '../src/engine.ts'
import { recordRound } from '../src/store.ts'
import {
  failedExecution,
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

describeDb('conversation scheduling and interruption', () => {
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
    const killed: Record<string, string>[] = []
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
      killOrphans: async (labels) => {
        killed.push(labels)
        return ['execution-1']
      },
    })
    engines.push(engine)

    return { engine, ws, stagesDispatcher, conversationsDispatcher, killed }
  }

  async function seed(options: Parameters<typeof seedTask>[1] = {}) {
    const seeded = await seedTask(db, options)
    created.push(seeded.task.id)

    return seeded
  }

  async function seedMessage(taskId: string) {
    const store = createConversationStore(db)
    const conversation = await openConversation(store, {
      taskId,
      idempotencyKey: crypto.randomUUID(),
    })
    const messages = await appendOwnerMessage(store, {
      conversationId: conversation.id,
      content: 'What changed?',
      idempotencyKey: crypto.randomUUID(),
    })

    return { conversation, ...messages }
  }

  async function eventTypes(taskId: string): Promise<string[]> {
    const rows = await db
      .select({ type: events.type })
      .from(events)
      .where(eq(events.taskId, taskId))
      .orderBy(asc(events.seq))

    return rows.map((row) => row.type)
  }

  test('dispatches a conversation response beside a running stage', async () => {
    const { engine, stagesDispatcher, conversationsDispatcher } = makeEngine()
    const { task, graph } = await seed({ at: 'specify' })
    const [decision] = await db
      .insert(decisions)
      .values({
        taskId: task.id,
        nodeKey: 'specify',
        key: 'review-direction',
        kind: 'question',
        promptMd: 'Which direction should the review take?',
      })
      .returning({ id: decisions.id })
    assert(decision)
    await seedMessage(task.id)
    let finishStage: (value: StageExecution) => void = () => {}
    let finishResponse: (value: ConversationExecution) => void = () => {}
    stagesDispatcher.plan(
      () =>
        new Promise((resolve) => {
          finishStage = resolve
        }),
    )
    conversationsDispatcher.plan(
      () =>
        new Promise((resolve) => {
          finishResponse = resolve
        }),
    )

    expect(await engine.tick()).toBe(2)
    await until(
      () =>
        stagesDispatcher.dispatches.length === 1 && conversationsDispatcher.dispatches.length === 1,
    )
    expect(conversationsDispatcher.dispatches[0]?.context).toBe('')
    expect(conversationsDispatcher.dispatches[0]?.ownerMessage.contentMd).toBe('What changed?')
    expect(conversationsDispatcher.dispatches[0]?.actionOptions).toEqual(
      expect.arrayContaining([
        {
          kind: 'answer_decision',
          target: { taskId: task.id, graphId: graph.id, decisionId: decision.id },
          expectedVersion: {
            taskStatus: 'specify',
            graphId: graph.id,
            decisionStatus: 'open',
          },
          instruction: 'required',
          description: 'Answer the open decision: Which direction should the review take?',
        },
        {
          kind: 'instruct_next_run',
          target: { taskId: task.id, graphId: graph.id, nodeKey: 'specify' },
          expectedVersion: { taskStatus: 'specify', graphId: graph.id },
          instruction: 'required',
          description: 'Attach guidance to the next run of stage specify.',
        },
      ]),
    )

    finishResponse(okConversationExecution())
    finishStage(okExecution('planner'))
    await engine.idle()
  })

  test('answers queued messages FIFO and retries one failed response', async () => {
    const { engine, conversationsDispatcher, ws } = makeEngine()
    const { task } = await seed({ at: 'specify', status: 'human_spec_gate' })
    const first = await seedMessage(task.id)
    await appendOwnerMessage(createConversationStore(db), {
      conversationId: first.conversation.id,
      content: 'And after that?',
      idempotencyKey: crypto.randomUUID(),
    })
    conversationsDispatcher.plan(() => ({
      status: 'failed',
      failure: 'provider_error',
      detail: 'temporary',
      durationMs: 1,
    }))

    await engine.tick()
    await engine.idle()
    expect(conversationsDispatcher.dispatches[0]).toMatchObject({
      ownerMessage: { contentMd: 'What changed?' },
      contextPath: 'none',
    })
    expect(
      (
        await db
          .select()
          .from(conversationMessages)
          .where(eq(conversationMessages.id, first.response.id))
      )[0],
    ).toMatchObject({
      status: 'queued',
      telemetry: [expect.any(Object)],
    })

    conversationsDispatcher.plan(() => okConversationExecution('Recovered.'))
    await engine.tick()
    await engine.idle()
    const rows = await db
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, first.conversation.id))
    expect(rows.find((row) => row.id === first.response.id)).toMatchObject({
      status: 'completed',
      contentMd: 'Recovered.',
    })

    conversationsDispatcher.plan(() => okConversationExecution('Second response.'))
    await engine.tick()
    await engine.idle()
    expect(conversationsDispatcher.dispatches[2]).toMatchObject({
      ownerMessage: { contentMd: 'And after that?' },
      contextPath: 'reconstructed',
    })
    expect(conversationsDispatcher.dispatches[2]?.context).toContain('Recovered.')
    expect(ws.calls.conversationProvisioned).toHaveLength(3)
    expect(ws.calls.conversationReleased).toEqual(
      expect.arrayContaining(ws.calls.conversationProvisioned),
    )
  })

  test('stops only the exact running attempt, discards it, and restarts from the same node', async () => {
    const { engine, stagesDispatcher, ws, killed } = makeEngine()
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

    const stopping = engine.stopStage({
      taskId: task.id,
      stageId: running.id,
      graphId: running.graphId,
      nodeKey: running.nodeKey,
      attempt: running.attempt,
      actor: 'owner',
    })
    await until(() => killed.length === 1)
    finish(okExecution('planner'))
    await stopping
    expect(await reload(db, task.id)).toMatchObject({ status: 'paused', resumeStatus: 'specify' })
    expect(ws.calls.discarded).toContain(task.slug)
    expect(killed).toContainEqual({
      'specmate.task': task.id,
      'specmate.node': 'specify',
      'specmate.attempt': '0',
    })
    await expect(
      engine.stopStage({
        taskId: task.id,
        stageId: running.id,
        graphId: running.graphId,
        nodeKey: running.nodeKey,
        attempt: running.attempt,
        actor: 'owner',
      }),
    ).rejects.toThrow(StageStopConflictError)

    await engine.restartInterruptedStage({
      taskId: task.id,
      stageId: running.id,
      actor: 'owner',
      guidance: 'Use the bounded variant.',
      idempotencyKey: `restart:${running.id}`,
    })
    expect((await reload(db, task.id)).status).toBe('specify')
    const [intervention] = await db.select().from(feedback).where(eq(feedback.taskId, task.id))
    expect(intervention).toMatchObject({
      kind: 'intervention',
      textMd: 'Use the bounded variant.',
    })

    await engine.idle()
    expect((await db.select().from(stages).where(eq(stages.id, running.id)))[0]?.status).toBe(
      'interrupted',
    )
  })

  it('the stop aborts the run behind the kill, not only its container', async () => {
    const { engine, stagesDispatcher } = makeEngine()
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
    const [dispatch] = stagesDispatcher.dispatches
    assert(dispatch)
    expect(dispatch.signal.aborted).toBe(false)

    const stopping = engine.stopStage({
      taskId: task.id,
      stageId: running.id,
      graphId: running.graphId,
      nodeKey: running.nodeKey,
      attempt: running.attempt,
      actor: 'owner',
    })

    // The kill ends the attempt on the wire; the signal is what stops the retry
    // loop from reading that kill as one more failure and starting again.
    await until(() => dispatch.signal.aborted)
    finish(okExecution('planner'))
    await stopping
  })

  test('persists proposals inertly until confirmation records a future-run intervention', async () => {
    const { engine, conversationsDispatcher } = makeEngine()
    const { task } = await seed({ at: 'specify', status: 'human_spec_gate' })
    const seeded = await seedMessage(task.id)
    conversationsDispatcher.plan(() => ({
      ...okConversationExecution('I can pass that guidance on.'),
      actions: [
        {
          kind: 'instruct_next_run',
          target: { taskId: task.id, nodeKey: 'implement' },
          instruction: 'Keep the migration additive.',
          expectedVersion: { taskStatus: 'human_spec_gate' },
        },
      ],
    }))
    await engine.tick()
    await engine.idle()
    const [action] = await db
      .select()
      .from(conversationActions)
      .where(eq(conversationActions.conversationId, seeded.conversation.id))
    assert(action)
    expect(action.status).toBe('proposed')
    expect(await db.select().from(feedback).where(eq(feedback.kind, 'intervention'))).toHaveLength(
      0,
    )

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await engine.confirmAction({
        taskId: task.id,
        actionId: action.id,
        actor: 'owner',
        idempotencyKey: `confirm:${action.id}`,
      })
    }
    expect(
      (await db.select().from(conversationActions).where(eq(conversationActions.id, action.id)))[0]
        ?.status,
    ).toBe('applied')
    expect(await db.select().from(feedback).where(eq(feedback.kind, 'intervention'))).toHaveLength(
      1,
    )
    expect(
      (await db.select().from(conversations).where(eq(conversations.id, seeded.conversation.id)))[0]
        ?.contextCommit,
    ).toBe('fake-conversation-head')

    const [stale] = await db
      .insert(conversationActions)
      .values({
        taskId: task.id,
        conversationId: seeded.conversation.id,
        messageId: action.messageId,
        kind: 'instruct_next_run',
        target: { taskId: task.id, nodeKey: 'implement' },
        instruction: 'This is stale.',
        expectedVersion: { taskStatus: 'specify' },
      })
      .returning()
    assert(stale)
    await expect(
      engine.confirmAction({
        taskId: task.id,
        actionId: stale.id,
        actor: 'owner',
        idempotencyKey: `confirm:${stale.id}`,
      }),
    ).rejects.toThrow('expected task specify')
    expect(
      (await db.select().from(conversationActions).where(eq(conversationActions.id, stale.id)))[0],
    ).toMatchObject({ status: 'conflict' })
  })

  test('startup recovery repeats an applying stop and leaves one safely paused task', async () => {
    const { engine, ws, killed } = makeEngine()
    const { task, graph } = await seed({ at: 'specify', status: 'paused' })
    await db.update(tasks).set({ resumeStatus: 'specify' }).where(eq(tasks.id, task.id))
    const [stage] = await db
      .insert(stages)
      .values({
        taskId: task.id,
        graphId: graph.id,
        nodeKey: 'specify',
        role: 'planner',
        provider: 'claude-code',
        status: 'interrupted',
        attempt: 0,
        interruptionCleanupStatus: 'pending',
      })
      .returning()
    assert(stage)

    expect(await engine.sweep()).toBe(1)
    expect(killed).toContainEqual({
      'specmate.task': task.id,
      'specmate.node': 'specify',
      'specmate.attempt': '0',
    })
    expect(ws.calls.discarded).toContain(task.slug)
    expect((await db.select().from(stages).where(eq(stages.id, stage.id)))[0]).toMatchObject({
      status: 'interrupted',
      interruptionCleanupStatus: 'succeeded',
    })
    expect(await reload(db, task.id)).toMatchObject({ status: 'paused', resumeStatus: 'specify' })
  })

  test('approve follows the gate’s approve edge and records who acted', async () => {
    const { engine } = makeEngine()
    const { task } = await seed({ at: 'specify', status: 'human_spec_gate' })

    await engine.approve(task.id, 'evgeny')

    expect((await reload(db, task.id)).status).toBe('implement')
    const [event] = await db
      .select()
      .from(events)
      .where(sql`${events.taskId} = ${task.id} and ${events.type} = 'gate.approved'`)
    expect(event?.payload.actor).toBe('evgeny')
    expect(event?.payload.gate).toBe('human_spec_gate')
  })

  test('gate operations are rejected away from a gate', async () => {
    const { engine } = makeEngine()
    const { task } = await seed({ at: 'specify' })

    await expect(engine.approve(task.id, 'evgeny')).rejects.toThrow(NotAtGateError)
    await expect(
      engine.rework({ taskId: task.id, actor: 'evgeny', target: 'specify' }),
    ).rejects.toThrow(NotAtGateError)
  })

  test('redirect follows its edge, records feedback, and counts against its cap', async () => {
    const { engine } = makeEngine()
    const { task } = await seed({
      at: 'specify',
      status: 'human_kickoff_gate',
      caps: { max_kickoff_regenerations: 1 },
    })

    await engine.redirect(task.id, 'evgeny', 'sharper scope, please')

    expect((await reload(db, task.id)).status).toBe('planning')
    const notes = await db.select().from(feedback).where(eq(feedback.taskId, task.id))
    expect(notes[0]?.kind).toBe('redirect')
    expect(notes[0]?.textMd).toBe('sharper scope, please')

    await db.update(tasks).set({ status: 'human_kickoff_gate' }).where(eq(tasks.id, task.id))
    await expect(engine.redirect(task.id, 'evgeny')).rejects.toThrow(RedirectCapExhaustedError)
  })

  test('rework re-enters a declared target and resets the round counters', async () => {
    const { engine, stagesDispatcher } = makeEngine()
    const { task } = await seed({ at: 'specify', status: 'human_spec_gate' })
    for (const round of [1, 2, 3]) {
      await recordRound(db, task.id, { loop: 'spec', round, verdict: 'revise', findings: [] })
    }

    await expect(
      engine.rework({ taskId: task.id, actor: 'evgeny', target: 'implement' }),
    ).rejects.toThrow(ReworkTargetError)
    await engine.rework({ taskId: task.id, actor: 'evgeny', target: 'specify' })

    expect((await reload(db, task.id)).status).toBe('specify')
    const notes = await db.select().from(feedback).where(eq(feedback.taskId, task.id))
    expect(notes[0]?.target).toEqual({ nodeKey: 'specify' })

    // With the counters reset, a fourth revise still fits the cap of three.
    await db.update(tasks).set({ status: 'spec_review' }).where(eq(tasks.id, task.id))
    stagesDispatcher.plan(() => okExecution('reviewer', { verdict: 'revise' }))
    await engine.tick()
    await engine.idle()

    const after = await reload(db, task.id)
    expect(after.status).toBe('specify')
    const rounds = await db.select().from(iterations).where(eq(iterations.taskId, task.id))
    expect(rounds).toHaveLength(4)
  })

  test('AC-430, AC-431: a rework edge into a node this walk skipped is refused, and approve still stands', async () => {
    const { engine } = makeEngine()
    const { task, graph } = await seed({ at: 'specify', status: 'human_spec_gate' })
    await db.insert(events).values({
      taskId: task.id,
      type: 'stage.skipped',
      payload: {
        node: 'specify',
        reason: 'the repository has no specification suite for this to land in',
        to: 'spec_review',
        graph: graph.id,
      },
    })

    await expect(
      engine.rework({ taskId: task.id, actor: 'evgeny', target: 'specify' }),
    ).rejects.toThrow(SkippedTargetError)
    expect((await reload(db, task.id)).status).toBe('human_spec_gate')

    // The edges a gate always has are not the ones the suppression touches.
    await engine.approve(task.id, 'evgeny')
    expect((await reload(db, task.id)).status).toBe('implement')
  })

  test('AC-432: the same edge stands for a task that ran the target', async () => {
    const { engine } = makeEngine()
    const { task, graph } = await seed({ at: 'specify', status: 'human_spec_gate' })
    // A skip on some other walk says nothing about this one.
    await db.insert(events).values({
      taskId: task.id,
      type: 'stage.skipped',
      payload: {
        node: 'specify',
        reason: 'on an earlier graph',
        to: 'spec_review',
        graph: 'other',
      },
    })
    expect(graph.id).not.toBe('other')

    await engine.rework({ taskId: task.id, actor: 'evgeny', target: 'specify' })

    expect((await reload(db, task.id)).status).toBe('specify')
  })

  test('resume returns a paused task exactly where it stopped', async () => {
    const { engine } = makeEngine()
    const { task } = await seed({ at: 'specify', status: 'paused', resume: 'spec_review' })

    await engine.resume(task.id, 'evgeny')

    const resumed = await reload(db, task.id)
    expect(resumed.status).toBe('spec_review')
    expect(resumed.resumeStatus).toBeNull()
  })

  test('resume refuses a waiting_human task; only answering or dismissing its decisions moves it', async () => {
    const { engine } = makeEngine()
    const { task } = await seed({ at: 'specify', status: 'waiting_human', resume: 'spec_review' })

    await expect(engine.resume(task.id, 'evgeny')).rejects.toThrow(NotParkedError)
    expect((await reload(db, task.id)).status).toBe('waiting_human')
  })

  test('a task cancelled while its stage runs stays cancelled', async () => {
    const { engine, stagesDispatcher } = makeEngine()
    const { task } = await seed({ at: 'specify' })

    let release: (execution: StageExecution) => void = () => {}
    stagesDispatcher.plan(
      () =>
        new Promise<StageExecution>((resolve) => {
          release = resolve
        }),
    )

    expect(await engine.tick()).toBe(1)
    await until(() => stagesDispatcher.dispatches.length === 1)
    await engine.cancel(task.id, 'evgeny')
    expect((await reload(db, task.id)).status).toBe('cancelled')

    release(okExecution('planner'))
    await engine.idle()

    // completeStage() checks the live task status against the node it was
    // dispatched for; once cancelled the two no longer match, so bookkeeping
    // no-ops instead of resurrecting the task or rewriting the stage row.
    expect((await reload(db, task.id)).status).toBe('cancelled')
    const [row] = await db.select().from(stages).where(eq(stages.taskId, task.id))
    expect(row?.status).toBe('running')
  })

  test('a parked task can be cancelled', async () => {
    const { engine, ws } = makeEngine()
    const { task } = await seed({ at: 'specify', status: 'waiting_human', resume: 'spec_review' })

    await engine.cancel(task.id, 'evgeny')

    expect((await reload(db, task.id)).status).toBe('cancelled')
    expect(ws.calls.released).toContain(task.id)
  })

  test('restart re-enters the failed stage; only a failed task restarts', async () => {
    const { engine } = makeEngine()
    const { task } = await seed({ at: 'implement', status: 'failed', resume: 'implement' })

    await engine.restart(task.id, 'evgeny')

    const restarted = await reload(db, task.id)
    expect(restarted.status).toBe('implement')
    expect(restarted.resumeStatus).toBeNull()
    expect(await eventTypes(task.id)).toContain('task.restarted')
    await expect(engine.restart(task.id, 'evgeny')).rejects.toThrow(NotRestartableError)

    const explicit = await seed({ at: 'implement', status: 'failed', resume: 'implement' })
    await engine.restart(explicit.task.id, 'evgeny', 'specify')
    expect((await reload(db, explicit.task.id)).status).toBe('specify')
  })

  test('guidance survives the attempt it was written for — AC-129', async () => {
    const { engine, stagesDispatcher } = makeEngine({ stageAttemptCap: 3 })
    const { task, graph } = await seed({ at: 'implement' })
    await db.insert(feedback).values({
      taskId: task.id,
      kind: 'intervention',
      textMd: 'Keep the migration reversible.',
      target: { graphId: graph.id, nodeKey: 'implement' },
    })
    stagesDispatcher.plan(() => failedExecution())

    await engine.tick()
    await engine.idle()

    // The first attempt claimed it and failed; the claim goes back so the
    // retry's ledger carries it instead of losing it silently.
    const [afterFailure] = await db.select().from(feedback).where(eq(feedback.taskId, task.id))
    expect(afterFailure?.consumedByStageId).toBeNull()

    stagesDispatcher.plan(() => okExecution('implementer'))
    await engine.tick()
    await engine.idle()

    const [afterAcceptance] = await db.select().from(feedback).where(eq(feedback.taskId, task.id))
    expect(afterAcceptance?.consumedByStageId).not.toBeNull()
  })

  it('AC-645: a failure no retry can fix fails the task without a second dispatch', async () => {
    const { engine, stagesDispatcher } = makeEngine({ stageAttemptCap: 2 })
    const { task } = await seed({ at: 'implement' })
    stagesDispatcher.plan(() => failedExecution('backend_error', 'pull access denied'))

    await engine.tick()
    await engine.idle()

    const failed = await reload(db, task.id)
    expect(failed.status).toBe('failed')
    expect(failed.resumeStatus).toBe('implement')
    expect(stagesDispatcher.dispatches).toHaveLength(1)

    const rows = await db.select().from(stages).where(eq(stages.taskId, task.id))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.cost.failure).toMatchObject({ reason: 'backend_error' })
  })

  it('AC-646: a failure that might not recur still retries to the cap', async () => {
    const { engine, stagesDispatcher } = makeEngine({ stageAttemptCap: 2 })
    const { task } = await seed({ at: 'implement' })
    stagesDispatcher.plan(() => failedExecution('timeout', 'no result in time'))

    await engine.tick()
    await engine.idle()
    expect((await reload(db, task.id)).status).toBe('implement')

    await engine.tick()
    await engine.idle()
    expect((await reload(db, task.id)).status).toBe('failed')
    expect(stagesDispatcher.dispatches).toHaveLength(2)
  })

  test('restart refuses a stage later than the one that failed', async () => {
    const { engine } = makeEngine()
    const { task } = await seed({ at: 'implement', status: 'failed', resume: 'implement' })

    await expect(engine.restart(task.id, 'evgeny', 'validate')).rejects.toThrow(RestartTargetError)
    expect((await reload(db, task.id)).status).toBe('failed')
  })

  test('restart grants a fresh attempt budget instead of one extra try', async () => {
    const { engine, stagesDispatcher } = makeEngine({ stageAttemptCap: 2 })
    const { task } = await seed({ at: 'implement' })
    stagesDispatcher.plan(() => failedExecution())

    await engine.tick()
    await engine.idle()
    await engine.tick()
    await engine.idle()
    expect((await reload(db, task.id)).status).toBe('failed')

    await engine.restart(task.id, 'evgeny')
    expect((await reload(db, task.id)).status).toBe('implement')

    // One post-restart failure must not immediately re-spend the cap: the two
    // failures before the restart no longer count toward the streak.
    await engine.tick()
    await engine.idle()
    expect((await reload(db, task.id)).status).toBe('implement')

    // The second post-restart failure does spend the (full, fresh) cap.
    await engine.tick()
    await engine.idle()
    const refailed = await reload(db, task.id)
    expect(refailed.status).toBe('failed')

    const rows = await db
      .select()
      .from(stages)
      .where(eq(stages.taskId, task.id))
      .orderBy(asc(stages.attempt))
    expect(rows.map((row) => row.attempt)).toEqual([0, 1, 2, 3])
    expect(rows.every((row) => row.status === 'failed')).toBe(true)
  })

  test('a loop-edged stage that returns no verdict is a failed attempt, not an approval', async () => {
    const { engine, stagesDispatcher } = makeEngine()
    const { task } = await seed({ at: 'spec_review' })
    stagesDispatcher.plan(() => okExecution('reviewer'))

    await engine.tick()
    await engine.idle()

    expect((await reload(db, task.id)).status).toBe('spec_review')
    const [row] = await db.select().from(stages).where(eq(stages.taskId, task.id))
    expect(row?.status).toBe('failed')
    expect(row?.cost.failure?.reason).toBe('missing_verdict')
  })

  test('the sweep keeps the tree as evidence when the cap is spent', async () => {
    const { engine, ws } = makeEngine()
    const { task, graph } = await seed({ at: 'implement' })
    await db.insert(stages).values({
      taskId: task.id,
      graphId: graph.id,
      nodeKey: 'implement',
      role: 'implementer',
      provider: 'claude-code',
      status: 'failed',
      attempt: 0,
    })
    await db.insert(stages).values({
      taskId: task.id,
      graphId: graph.id,
      nodeKey: 'implement',
      role: 'implementer',
      provider: 'claude-code',
      status: 'running',
      attempt: 1,
      startedAt: new Date(),
    })

    expect(await engine.sweep()).toBe(1)

    const failed = await reload(db, task.id)
    expect(failed.status).toBe('failed')
    expect(failed.resumeStatus).toBe('implement')
    // Out of attempts: the dead attempt's tree is the evidence — nothing is
    // provisioned or reset.
    expect(ws.calls.provisioned).toHaveLength(0)
    expect(ws.calls.discarded).toHaveLength(0)
  })

  test('final-gate approval enters publish without releasing the workspace; cancel releases', async () => {
    const { engine, ws } = makeEngine()
    const { task } = await seed({ at: 'specify', status: 'human_final_gate' })

    await engine.approve(task.id, 'evgeny')

    expect((await reload(db, task.id)).status).toBe('publish')
    expect(ws.calls.released).not.toContain(task.id)

    const other = await seed({ at: 'implement' })
    await engine.cancel(other.task.id, 'evgeny')
    expect((await reload(db, other.task.id)).status).toBe('cancelled')
    expect(ws.calls.released).toContain(other.task.id)
  })

  // AC-240, AC-114: with two providers configured, a role runs the one its task
  // bound, and the node that checks its work runs the other.
  test('two configured providers: the implementation runs one and its check runs the other', async () => {
    const { engine, stagesDispatcher } = makeEngine({
      availableProviders: ['claude-code', 'codex'],
    })
    const { task } = await seed({
      at: 'implement',
      modelBindings: { implementer: { provider: 'codex' } },
    })
    stagesDispatcher.plan((dispatch) => okExecution(dispatch.node.role, { verdict: 'approve' }))

    await engine.tick()
    await engine.idle()
    await engine.tick()
    await engine.idle()

    const ran = await db
      .select({ nodeKey: stages.nodeKey, provider: stages.provider })
      .from(stages)
      .where(eq(stages.taskId, task.id))
      .orderBy(asc(stages.createdAt))

    expect(ran.find((row) => row.nodeKey === 'implement')?.provider).toBe('codex')
    expect(ran.find((row) => row.nodeKey === 'validate')?.provider).toBe('claude-code')
  })

  test('one configured provider checks its own work rather than skipping the check', async () => {
    const { engine, stagesDispatcher } = makeEngine({ availableProviders: ['claude-code'] })
    const { task } = await seed({
      at: 'implement',
      modelBindings: { implementer: { provider: 'codex' } },
    })
    stagesDispatcher.plan((dispatch) => okExecution(dispatch.node.role, { verdict: 'approve' }))

    await engine.tick()
    await engine.idle()

    const [ran] = await db
      .select({ provider: stages.provider })
      .from(stages)
      .where(and(eq(stages.taskId, task.id), eq(stages.nodeKey, 'implement')))

    // The binding names a provider this deployment does not run; dispatch falls
    // back to one it does rather than failing the stage.
    expect(ran?.provider).toBe('claude-code')
  })
})
