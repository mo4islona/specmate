import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { createDb, type Database, events, feedback, iterations, stages, tasks } from '@specmate/db'
import type { StageExecution } from '@specmate/runner'
import { asc, eq, inArray, sql } from 'drizzle-orm'
import {
  Engine,
  type EngineSettings,
  NotAtGateError,
  NotRestartableError,
  RedirectCapExhaustedError,
  ReworkTargetError,
} from '../src/engine.ts'
import { recordRound } from '../src/store.ts'
import {
  failedExecution,
  fakeDispatcher,
  fakeWorkspaces,
  okExecution,
  reload,
  seedTask,
  until,
} from './fixtures.ts'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

describeDb('the loop', () => {
  let db: Database
  const created: string[] = []
  const engines: Engine[] = []

  beforeAll(() => {
    db = createDb(url)
  })

  // The poll is global by design, so each test cleans its tasks up right away —
  // a leftover runnable task would eat the next test's only concurrency slot.
  afterEach(async () => {
    for (const engine of engines.splice(0)) await engine.idle()
    if (created.length > 0) await db.delete(tasks).where(inArray(tasks.id, created.splice(0)))
  })

  function makeEngine(overrides: Partial<EngineSettings> = {}) {
    const ws = fakeWorkspaces()
    const disp = fakeDispatcher()
    const logs: string[] = []
    const killed: Record<string, string>[] = []
    const engine = new Engine({
      db,
      workspaces: ws.workspaces,
      settings: {
        stageConcurrency: 1,
        stageAttemptCap: 2,
        availableProviders: ['claude-code'],
        ...overrides,
      },
      dispatcher: disp.dispatcher,
      killOrphans: async (labels) => {
        killed.push(labels)
        return ['dead-container']
      },
      log: (message) => logs.push(message),
    })
    engines.push(engine)

    return { engine, ws, disp, logs, killed }
  }

  async function seed(options: Parameters<typeof seedTask>[1] = {}) {
    const seeded = await seedTask(db, options)
    created.push(seeded.task.id)

    return seeded
  }

  async function eventTypes(taskId: string): Promise<string[]> {
    const rows = await db
      .select({ type: events.type })
      .from(events)
      .where(eq(events.taskId, taskId))
      .orderBy(asc(events.seq))

    return rows.map((row) => row.type)
  }

  test('a tick dispatches one stage under concurrency 1, even with two runnable tasks', async () => {
    const { engine, disp } = makeEngine()
    const first = await seed({ at: 'research' })
    const second = await seed({ at: 'research' })

    let release: (execution: StageExecution) => void = () => {}
    disp.plan(
      () =>
        new Promise<StageExecution>((resolve) => {
          release = resolve
        }),
    )

    expect(await engine.tick()).toBe(1)
    await until(() => disp.dispatches.length === 1)
    // The claimed stage is still running, so a second tick has no free slot.
    expect(await engine.tick()).toBe(0)
    expect(disp.dispatches).toHaveLength(1)

    release(okExecution('researcher'))
    await engine.idle()
    disp.plan(() => okExecution('researcher'))
    expect(await engine.tick()).toBe(1)
    await engine.idle()

    const dispatchedTasks = new Set(disp.dispatches.map((d) => d.task.id))
    expect(dispatchedTasks).toEqual(new Set([first.task.id, second.task.id]))
  })

  test('a completed stage moves the task to the next node with the exact event sequence', async () => {
    const { engine, ws, disp } = makeEngine()
    const { task } = await seed({ at: 'research' })
    disp.plan(() => okExecution('researcher'))

    await engine.tick()
    await engine.idle()

    const after = await reload(db, task.id)
    expect(after.status).toBe('spec_review')
    expect(ws.calls.provisioned).toContain(task.slug)
    expect(await eventTypes(task.id)).toEqual([
      'task.created',
      'stage.dispatched',
      'stage.completed',
      'task.transitioned',
    ])
    const [row] = await db.select().from(stages).where(eq(stages.taskId, task.id))
    expect(row?.status).toBe('succeeded')
    expect(row?.nodeKey).toBe('research')
    expect(row?.attempt).toBe(0)
  })

  test('a review stage binds cross-provider and records the binding on the stage', async () => {
    const { engine, disp } = makeEngine()
    const { task, graph } = await seed({ at: 'spec_review' })
    await db.insert(stages).values({
      taskId: task.id,
      graphId: graph.id,
      nodeKey: 'research',
      role: 'researcher',
      provider: 'claude-code',
      status: 'succeeded',
      attempt: 0,
    })
    disp.plan(() => okExecution('reviewer', { verdict: 'approve' }))

    await engine.tick()
    await engine.idle()

    // One configured provider: the review runs on the writer, per agent-contracts.
    const [review] = await db
      .select()
      .from(stages)
      .where(eq(stages.nodeKey, 'spec_review'))
      .orderBy(asc(stages.createdAt))
    expect(review?.provider).toBe('claude-code')
    expect(disp.dispatches[0]?.provider).toBe('claude-code')
  })

  test('telemetry from the envelope lands on the attempt row; absent stays null', async () => {
    const { engine, disp } = makeEngine()
    const { task } = await seed({ at: 'research' })
    disp.plan(() => okExecution('researcher'))

    await engine.tick()
    await engine.idle()

    const [row] = await db.select().from(stages).where(eq(stages.taskId, task.id))
    expect(row?.cost.model).toBe('stub-model-1')
    expect(row?.cost.tokens).toEqual({ input_tokens: 1200, output_tokens: 340 })
    expect(row?.cost.costUsd).toBe(0.42)
    expect(row?.startedAt).not.toBeNull()
    expect(row?.finishedAt).not.toBeNull()

    // Take the first task out of the running so the single slot is free.
    await db.update(tasks).set({ status: 'paused' }).where(eq(tasks.id, task.id))

    const garbled = await seed({ at: 'research' })
    disp.plan(() => okExecution('researcher', { telemetry: null }))
    await engine.tick()
    await engine.idle()

    const [bare] = await db.select().from(stages).where(eq(stages.taskId, garbled.task.id))
    expect(bare?.status).toBe('succeeded')
    expect(bare?.cost.model).toBeNull()
    expect(bare?.cost.tokens).toBeNull()
    expect(bare?.cost.costUsd).toBeNull()
  })

  test('revise records the round and loops back; the cap parks instead', async () => {
    const { engine, disp } = makeEngine()
    const { task } = await seed({ at: 'spec_review' })
    disp.plan(() =>
      okExecution('reviewer', {
        verdict: 'revise',
        findings: [{ id: 'gap', severity: 'major', title: 'Missing scenario' }],
      }),
    )

    await engine.tick()
    await engine.idle()

    expect((await reload(db, task.id)).status).toBe('research')
    const rounds = await db.select().from(iterations).where(eq(iterations.taskId, task.id))
    expect(rounds).toHaveLength(1)
    expect(rounds[0]?.reviewerVerdict).toBe('revise')
    expect(rounds[0]?.findings[0]?.id).toBe('gap')

    // Two more revise rounds exhaust the default cap of three.
    await recordRound(db, task.id, { loop: 'spec', round: 2, verdict: 'revise', findings: [] })
    await recordRound(db, task.id, { loop: 'spec', round: 3, verdict: 'revise', findings: [] })
    await db.update(tasks).set({ status: 'spec_review' }).where(eq(tasks.id, task.id))

    await engine.tick()
    await engine.idle()

    const parked = await reload(db, task.id)
    expect(parked.status).toBe('waiting_human')
    expect(parked.resumeStatus).toBe('spec_review')
    expect(await eventTypes(task.id)).toContain('task.parked')
  })

  test('an escalate verdict parks the task naming the cause', async () => {
    const { engine, disp } = makeEngine()
    const { task } = await seed({ at: 'spec_review' })
    disp.plan(() => okExecution('reviewer', { verdict: 'escalate' }))

    await engine.tick()
    await engine.idle()

    const parked = await reload(db, task.id)
    expect(parked.status).toBe('waiting_human')
    expect(parked.resumeStatus).toBe('spec_review')
    const [event] = await db
      .select()
      .from(events)
      .where(sql`${events.taskId} = ${task.id} and ${events.type} = 'task.parked'`)
    expect(event?.payload.cause).toBe('escalate')
  })

  test('a failed attempt discards the workspace and the next tick re-dispatches; the cap fails the task', async () => {
    const { engine, ws, disp } = makeEngine()
    const { task } = await seed({ at: 'implement' })
    disp.plan(() => failedExecution('timeout', 'no result within 1000ms'))

    await engine.tick()
    await engine.idle()

    expect((await reload(db, task.id)).status).toBe('implement')
    expect(ws.calls.discarded).toContain(task.slug)

    await engine.tick()
    await engine.idle()

    const failed = await reload(db, task.id)
    expect(failed.status).toBe('failed')
    expect(failed.resumeStatus).toBe('implement')

    const rows = await db
      .select()
      .from(stages)
      .where(eq(stages.taskId, task.id))
      .orderBy(asc(stages.attempt))
    expect(rows.map((row) => row.attempt)).toEqual([0, 1])
    expect(rows.every((row) => row.status === 'failed')).toBe(true)
    expect(rows[1]?.cost.failure?.reason).toBe('timeout')

    const [event] = await db
      .select()
      .from(events)
      .where(sql`${events.taskId} = ${task.id} and ${events.type} = 'task.failed'`)
    expect(event?.payload.stage).toBe('implement')
    expect(event?.payload.reason).toBe('timeout')
  })

  test('an agent-reported failure in a valid result is a failed attempt, not an advance', async () => {
    const { engine, disp } = makeEngine()
    const { task } = await seed({ at: 'research' })
    disp.plan(() => {
      const execution = okExecution('researcher')
      if (!execution.result) throw new Error('fixture always carries a result')

      return { ...execution, result: { ...execution.result, status: 'failed' } }
    })

    await engine.tick()
    await engine.idle()

    expect((await reload(db, task.id)).status).toBe('research')
    const [row] = await db.select().from(stages).where(eq(stages.taskId, task.id))
    expect(row?.status).toBe('failed')
    expect(row?.cost.failure?.reason).toBe('agent_failed')
  })

  test('the sweep settles a running stage in place and the next tick re-runs it', async () => {
    const { engine, disp, logs, killed } = makeEngine()
    const { task, graph } = await seed({ at: 'research' })
    const [orphan] = await db
      .insert(stages)
      .values({
        taskId: task.id,
        graphId: graph.id,
        nodeKey: 'research',
        role: 'researcher',
        provider: 'claude-code',
        status: 'running',
        attempt: 0,
        startedAt: new Date(),
      })
      .returning()

    expect(await engine.sweep()).toBe(1)

    const settled = await db
      .select()
      .from(stages)
      .where(eq(stages.id, orphan?.id ?? ''))
    expect(settled[0]?.status).toBe('failed')
    expect(settled[0]?.cost.failure?.reason).toBe('orphaned')
    expect(killed[0]).toEqual({ 'specmate.task': task.id, 'specmate.node': 'research' })
    expect(logs.join('\n')).toContain(task.id)
    expect(logs.join('\n')).toContain('research')
    expect(logs.join('\n')).toContain('attempt 0')

    disp.plan(() => okExecution('researcher'))
    await engine.tick()
    await engine.idle()

    const rows = await db
      .select()
      .from(stages)
      .where(eq(stages.taskId, task.id))
      .orderBy(asc(stages.attempt))
    expect(rows.map((row) => [row.attempt, row.status])).toEqual([
      [0, 'failed'],
      [1, 'succeeded'],
    ])
    expect((await reload(db, task.id)).status).toBe('spec_review')
  })

  test('the sweep leaves parked and gated tasks untouched', async () => {
    const { engine } = makeEngine()
    const { task } = await seed({ at: 'research', status: 'human_spec_gate' })
    const before = await reload(db, task.id)

    await engine.sweep()
    await engine.tick()
    await engine.idle()

    const after = await reload(db, task.id)
    expect(after).toEqual(before)
    expect(await db.select().from(stages).where(eq(stages.taskId, task.id))).toHaveLength(0)
  })

  test('approve follows the gate’s approve edge and records who acted', async () => {
    const { engine } = makeEngine()
    const { task } = await seed({ at: 'research', status: 'human_spec_gate' })

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
    const { task } = await seed({ at: 'research' })

    await expect(engine.approve(task.id, 'evgeny')).rejects.toThrow(NotAtGateError)
    await expect(
      engine.rework({ taskId: task.id, actor: 'evgeny', target: 'research' }),
    ).rejects.toThrow(NotAtGateError)
  })

  test('redirect follows its edge, records feedback, and counts against its cap', async () => {
    const { engine } = makeEngine()
    const { task } = await seed({
      at: 'research',
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
    const { engine, disp } = makeEngine()
    const { task } = await seed({ at: 'research', status: 'human_spec_gate' })
    for (const round of [1, 2, 3]) {
      await recordRound(db, task.id, { loop: 'spec', round, verdict: 'revise', findings: [] })
    }

    await expect(
      engine.rework({ taskId: task.id, actor: 'evgeny', target: 'implement' }),
    ).rejects.toThrow(ReworkTargetError)
    await engine.rework({ taskId: task.id, actor: 'evgeny', target: 'research' })

    expect((await reload(db, task.id)).status).toBe('research')

    // With the counters reset, a fourth revise still fits the cap of three.
    await db.update(tasks).set({ status: 'spec_review' }).where(eq(tasks.id, task.id))
    disp.plan(() => okExecution('reviewer', { verdict: 'revise' }))
    await engine.tick()
    await engine.idle()

    const after = await reload(db, task.id)
    expect(after.status).toBe('research')
    const rounds = await db.select().from(iterations).where(eq(iterations.taskId, task.id))
    expect(rounds).toHaveLength(4)
  })

  test('resume returns a parked task exactly where it stopped', async () => {
    const { engine } = makeEngine()
    const { task } = await seed({ at: 'research', status: 'waiting_human', resume: 'spec_review' })

    await engine.resume(task.id, 'evgeny')

    const resumed = await reload(db, task.id)
    expect(resumed.status).toBe('spec_review')
    expect(resumed.resumeStatus).toBeNull()
  })

  test('a task cancelled while its stage runs stays cancelled', async () => {
    const { engine, disp } = makeEngine()
    const { task } = await seed({ at: 'research' })

    let release: (execution: StageExecution) => void = () => {}
    disp.plan(
      () =>
        new Promise<StageExecution>((resolve) => {
          release = resolve
        }),
    )

    expect(await engine.tick()).toBe(1)
    await until(() => disp.dispatches.length === 1)
    await engine.cancel(task.id, 'evgeny')
    expect((await reload(db, task.id)).status).toBe('cancelled')

    release(okExecution('researcher'))
    await engine.idle()

    // The stage's own record stands, but its completion must not resurrect
    // the cancelled task.
    expect((await reload(db, task.id)).status).toBe('cancelled')
    const [row] = await db.select().from(stages).where(eq(stages.taskId, task.id))
    expect(row?.status).toBe('succeeded')
  })

  test('a parked task can be cancelled', async () => {
    const { engine, ws } = makeEngine()
    const { task } = await seed({ at: 'research', status: 'waiting_human', resume: 'spec_review' })

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
    await engine.restart(explicit.task.id, 'evgeny', 'research')
    expect((await reload(db, explicit.task.id)).status).toBe('research')
  })

  test('a loop-edged stage that returns no verdict is a failed attempt, not an approval', async () => {
    const { engine, disp } = makeEngine()
    const { task } = await seed({ at: 'spec_review' })
    disp.plan(() => okExecution('reviewer'))

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

  test('final-gate approval archives and releases the workspace; cancel releases too', async () => {
    const { engine, ws } = makeEngine()
    const { task } = await seed({ at: 'research', status: 'human_final_gate' })

    await engine.approve(task.id, 'evgeny')

    expect((await reload(db, task.id)).status).toBe('archived')
    expect(ws.calls.released).toContain(task.id)

    const other = await seed({ at: 'implement' })
    await engine.cancel(other.task.id, 'evgeny')
    expect((await reload(db, other.task.id)).status).toBe('cancelled')
    expect(ws.calls.released).toContain(other.task.id)
  })

  test('tokens and cost aggregate per stage and per round from the store alone', async () => {
    const { task, graph } = await seed({ at: 'research' })
    const stamp = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000)
    const seedStage = async (
      nodeKey: 'research' | 'spec_review',
      attempt: number,
      createdAt: Date,
      costUsd: number,
      tokens: number,
    ) => {
      await db.insert(stages).values({
        taskId: task.id,
        graphId: graph.id,
        nodeKey,
        role: nodeKey === 'research' ? 'researcher' : 'reviewer',
        provider: 'claude-code',
        status: 'succeeded',
        attempt,
        createdAt,
        cost: { model: 'stub-model-1', tokens: { output_tokens: tokens }, costUsd, raw: {} },
      })
    }

    // Round one: research then its review; round two after the revise.
    await seedStage('research', 0, stamp(50), 1, 100)
    await seedStage('spec_review', 0, stamp(40), 2, 200)
    await db.insert(iterations).values({
      taskId: task.id,
      loop: 'spec',
      round: 1,
      reviewerVerdict: 'revise',
      findings: [],
      createdAt: stamp(39),
    })
    await seedStage('research', 1, stamp(30), 4, 400)
    await seedStage('spec_review', 1, stamp(20), 8, 800)
    await db.insert(iterations).values({
      taskId: task.id,
      loop: 'spec',
      round: 2,
      reviewerVerdict: 'approve',
      findings: [],
      createdAt: stamp(19),
    })

    const perStage = (await db.execute(sql`
      select node_key,
             sum((cost->>'costUsd')::numeric) as cost,
             sum((cost->'tokens'->>'output_tokens')::numeric) as tokens
      from stages where task_id = ${task.id}
      group by node_key order by node_key
    `)) as { node_key: string; cost: string; tokens: string }[]

    expect(perStage).toEqual([
      { node_key: 'research', cost: '5', tokens: '500' },
      { node_key: 'spec_review', cost: '10', tokens: '1000' },
    ])

    const perRound = (await db.execute(sql`
      with rounds as (
        select round, created_at,
               lag(created_at) over (order by round) as prior
        from iterations where task_id = ${task.id} and loop = 'spec'
      )
      select r.round,
             sum((s.cost->>'costUsd')::numeric) as cost,
             sum((s.cost->'tokens'->>'output_tokens')::numeric) as tokens
      from rounds r
      join stages s on s.task_id = ${task.id}
        and s.created_at <= r.created_at
        and (r.prior is null or s.created_at > r.prior)
      group by r.round order by r.round
    `)) as { round: number; cost: string; tokens: string }[]

    expect(perRound).toEqual([
      { round: 1, cost: '3', tokens: '300' },
      { round: 2, cost: '12', tokens: '1200' },
    ])
  })
})
