import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { appendOwnerMessage } from '@specmate/core'
import {
  conversationActions,
  conversations,
  createConversationStore,
  createDb,
  type Database,
  decisions,
  iterations,
  stages,
  type Task,
  tasks,
} from '@specmate/db'
import {
  ClaudeCodeProvider,
  ConversationExecutor,
  LocalBackend,
  renderLedgerForTask,
  resolveRunnerConfig,
  StageExecutor,
} from '@specmate/runner'
import {
  Git,
  resolveWorkspaceConfig,
  WorkspaceManager,
  WorkspaceService,
  worktreePath,
} from '@specmate/workspace'
import { and, asc, eq, inArray } from 'drizzle-orm'
import {
  cleanupTempDirs,
  makeHarness,
  STUB,
  STUB_ENV,
  setStubEnv,
  tempDir,
} from '../../../packages/runner/test/fixtures.ts'
import { type ConversationDispatcher, Engine, type StageDispatcher } from '../src/engine.ts'
import { taskRunnerEnvironment } from '../src/runner.ts'
import { createTask } from '../src/store.ts'
import { reload } from './fixtures.ts'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

const ADMIN = join(import.meta.dir, '../src/admin.ts')

/**
 * The loop end to end with everything real except the provider CLI: a git
 * origin, provisioned worktrees, the stage executor, the stub provider, and
 * the admin entry point — no network, no credential, no container runtime.
 */
describeDb('the loop against a real repository', () => {
  let db: Database
  let root: string
  let originUrl: string
  const created: string[] = []

  beforeAll(async () => {
    db = createDb(url)
    // makeHarness gives us a real origin; the engine provisions its own
    // worktrees from it under a root of ours.
    const harness = await makeHarness('e2e-origin-seed')
    originUrl = harness.workspace.repoUrl
    root = await tempDir('loop-root')
  })

  afterAll(async () => {
    if (created.length > 0) await db.delete(tasks).where(inArray(tasks.id, created))
    await cleanupTempDirs()
  })

  // The poll is global: a task left runnable would steal the next test's slot.
  afterEach(async () => {
    if (created.length > 0) {
      await db.update(tasks).set({ status: 'paused' }).where(inArray(tasks.id, created))
    }
  })

  function makeEngine(options: { beforeStage?: () => Promise<void> } = {}) {
    const manager = new WorkspaceManager({ config: { root } })
    const config = resolveRunnerConfig({
      backend: 'local',
      cli: STUB,
      rolesDir: join(import.meta.dir, '../../../roles'),
      stageTimeoutMs: 20_000,
      forwardEnv: STUB_ENV,
    })
    const backend = new LocalBackend(config)
    const provider = new ClaudeCodeProvider({ config, backend })
    const service = new WorkspaceService(manager, db, (workspace, image) =>
      backend.resolveEnvironment(workspace.path, image),
    )
    const executor = new StageExecutor({
      config,
      provider,
      git: new Git(manager.config),
      workspaces: service,
      ledger: (taskId) => renderLedgerForTask(db, config, taskId),
      deferCommit: true,
    })
    const conversationExecutor = new ConversationExecutor({
      config,
      provider,
      git: new Git(manager.config),
      ledger: (taskId) => renderLedgerForTask(db, config, taskId),
    })
    const dispatcher: StageDispatcher = async ({ task, node, stageId, attempt, workspace }) => {
      await options.beforeStage?.()
      const [current] = await db.select().from(tasks).where(eq(tasks.id, task.id)).limit(1)

      return executor.execute({
        taskId: task.id,
        stageId,
        node: node.key,
        role: node.role,
        workspace,
        baseBranch: task.baseBranch,
        environment: taskRunnerEnvironment(current?.environment ?? null),
        attempt,
      })
    }
    const conversationDispatcher: ConversationDispatcher = async ({
      task,
      conversationId,
      response,
      ownerMessage,
      context,
      previousAnchorCommit,
      previousTaskState,
      currentAnchorCommit,
      currentTaskState,
      contextPath,
      actionOptions,
      attempt,
      provider,
      workspace,
    }) => {
      const [current] = await db.select().from(tasks).where(eq(tasks.id, task.id)).limit(1)

      return conversationExecutor.execute({
        taskId: task.id,
        conversationId,
        responseId: response.id,
        message: ownerMessage.contentMd,
        context,
        previousAnchorCommit,
        previousTaskState,
        currentAnchorCommit,
        currentTaskState,
        contextPath,
        actionOptions,
        provider,
        workspace,
        baseBranch: task.baseBranch,
        environment: taskRunnerEnvironment(current?.environment ?? null),
        attempt,
      })
    }

    return new Engine({
      db,
      workspaces: {
        provision: (request) => service.provision({ ...request, image: config.image }),
        provisionConversation: (workspace, key) => service.provisionConversation(workspace, key),
        releaseConversation: (task, key) =>
          service.releaseConversation(task.slug, task.repoUrl, key),
        discard: (workspace, commit) => service.discard(workspace, commit),
        headCommit: (workspace) => service.headCommit(workspace),
        commitStage: (taskId, workspace, stage) => service.commitStage(taskId, workspace, stage),
        writeDecisionLog: (workspace, markdown) => service.writeDecisionLog(workspace, markdown),
        release: (taskId) => service.release(taskId),
      },
      settings: { stageConcurrency: 1, stageAttemptCap: 2, availableProviders: ['claude-code'] },
      dispatcher,
      conversationDispatcher,
    })
  }

  async function makeTask(): Promise<Task> {
    const slug = `e2e-${crypto.randomUUID().slice(0, 8)}`
    const { task } = await createTask(db, {
      slug,
      title: `E2E ${slug}`,
      type: 'feature',
      repoUrl: originUrl,
      at: 'research',
    })
    created.push(task.id)

    return task
  }

  async function queueModes(
    task: Task,
    modes: string[],
    options: { record?: string } = {},
  ): Promise<void> {
    const queue = join(await tempDir('stub-queue'), 'modes.json')
    await writeFile(queue, JSON.stringify(modes))
    setStubEnv({
      SPECMATE_STUB_MODE_FILE: queue,
      SPECMATE_STUB_SLUG: task.slug,
      ...(options.record ? { SPECMATE_STUB_RECORD: options.record } : {}),
    })
  }

  async function walkOneStage(engine: Engine): Promise<void> {
    expect(await engine.tick()).toBe(1)
    await engine.idle()
  }

  test('a seeded task walks research → spec review → the spec gate, and the command line approves it', async () => {
    const engine = makeEngine()
    const task = await makeTask()
    await queueModes(task, ['ok', 'approve'])

    await walkOneStage(engine)
    expect((await reload(db, task.id)).status).toBe('spec_review')

    await walkOneStage(engine)
    expect((await reload(db, task.id)).status).toBe('human_spec_gate')

    const rows = await db
      .select()
      .from(stages)
      .where(eq(stages.taskId, task.id))
      .orderBy(asc(stages.createdAt))
    expect(rows.map((row) => [row.nodeKey, row.status])).toEqual([
      ['research', 'succeeded'],
      ['spec_review', 'succeeded'],
    ])
    // The stub's real envelope landed as queryable telemetry.
    expect(rows[0]?.cost.model).toBe('stub-model-1')
    expect(rows[0]?.cost.costUsd).toBe(0.42)

    const approve = Bun.spawn(
      ['bun', ADMIN, 'approve', '--task', task.id, '--actor', 'command-line'],
      {
        env: {
          PATH: process.env.PATH ?? '',
          HOME: process.env.HOME ?? '',
          DATABASE_URL: url as string,
          WORKSPACE_ROOT: root,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    expect(await approve.exited).toBe(0)
    expect((await reload(db, task.id)).status).toBe('implement')
  })

  test('a retry reads the artifacts as last committed, not as the failed attempt left them', async () => {
    const engine = makeEngine()
    const task = await makeTask()
    // Dispatch one: a half-written tree then a hard failure — the executor's
    // inner retry and the dispatch both fail. Dispatch two succeeds.
    await queueModes(task, ['half-written', 'nonzero-exit', 'ok'])

    await walkOneStage(engine)
    expect((await reload(db, task.id)).status).toBe('research')

    await walkOneStage(engine)
    expect((await reload(db, task.id)).status).toBe('spec_review')

    const rows = await db
      .select()
      .from(stages)
      .where(eq(stages.taskId, task.id))
      .orderBy(asc(stages.attempt))
    expect(rows.map((row) => [row.attempt, row.status])).toEqual([
      [0, 'failed'],
      [1, 'succeeded'],
    ])

    const proposal = join(
      worktreePath(resolveWorkspaceConfig({ root }), task.slug),
      'openspec/changes',
      task.slug,
      'proposal.md',
    )
    expect(await readFile(proposal, 'utf8')).toBe('# written by the stub\n')
  })

  test('the admin CLI answers a decision and shows it once resolved', async () => {
    const task = await makeTask()
    const [decision] = await db
      .insert(decisions)
      .values({
        taskId: task.id,
        nodeKey: 'research',
        key: 'scope',
        kind: 'question',
        promptMd: 'What does this cover?',
      })
      .returning()
    if (!decision) throw new Error('decision insert returned no row')
    await db
      .update(tasks)
      .set({ status: 'waiting_human', resumeStatus: 'research' })
      .where(eq(tasks.id, task.id))

    const env = {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      DATABASE_URL: url as string,
      WORKSPACE_ROOT: root,
    }

    const shownBefore = Bun.spawn(['bun', ADMIN, 'show', '--task', task.id], {
      env,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    expect(await shownBefore.exited).toBe(0)
    const before = JSON.parse(await new Response(shownBefore.stdout).text()) as {
      openDecisions: { id: string }[]
    }
    expect(before.openDecisions.map((d) => d.id)).toEqual([decision.id])

    const answer = Bun.spawn(
      [
        'bun',
        ADMIN,
        'answer',
        '--task',
        task.id,
        '--decision',
        decision.id,
        '--text',
        'The whole repository.',
        '--actor',
        'command-line',
      ],
      { env, stdout: 'pipe', stderr: 'pipe' },
    )
    expect(await answer.exited).toBe(0)
    expect((await reload(db, task.id)).status).toBe('research')

    const shownAfter = Bun.spawn(['bun', ADMIN, 'show', '--task', task.id], {
      env,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    expect(await shownAfter.exited).toBe(0)
    const after = JSON.parse(await new Response(shownAfter.stdout).text()) as {
      openDecisions: unknown[]
    }
    expect(after.openDecisions).toHaveLength(0)
  })

  test('an answered decision reaches the next run’s assembled prompt', async () => {
    const engine = makeEngine()
    const task = await makeTask()
    await db.insert(decisions).values({
      taskId: task.id,
      nodeKey: 'research',
      key: 'scope',
      kind: 'question',
      promptMd: 'What does this cover?',
      status: 'answered',
      answerMd: 'The whole repository.',
      answeredBy: 'owner',
      answeredAt: new Date(),
    })
    const record = join(await tempDir('stub-record'), 'invocation.json')
    await queueModes(task, ['ok'], { record })

    await walkOneStage(engine)

    expect((await reload(db, task.id)).status).toBe('spec_review')
    const invocation = JSON.parse(await readFile(record, 'utf8')) as { prompt: string }
    expect(invocation.prompt).toContain('What does this cover?')
    expect(invocation.prompt).toContain('The whole repository.')
  })

  test('an agent’s edit to the decision log does not survive into the next stage', async () => {
    const engine = makeEngine()
    const task = await makeTask()
    const record = join(await tempDir('stub-record'), 'invocation.json')
    await queueModes(task, ['scribble-decision-log', 'approve'], { record })

    await walkOneStage(engine)
    expect((await reload(db, task.id)).status).toBe('spec_review')
    const decisionLog = join(
      worktreePath(resolveWorkspaceConfig({ root }), task.slug),
      'openspec/changes',
      task.slug,
      'decisions.md',
    )
    expect(await readFile(decisionLog, 'utf8')).toContain('an agent scribbled here')

    await walkOneStage(engine)
    expect((await reload(db, task.id)).status).toBe('human_spec_gate')

    expect(await readFile(decisionLog, 'utf8')).not.toContain('scribbled')
    const invocation = JSON.parse(await readFile(record, 'utf8')) as { prompt: string }
    expect(invocation.prompt).not.toContain('scribbled')
    expect(invocation.prompt).toContain('No decisions have been raised on this task yet.')
  })

  test('a dispatch whose runner retried internally still counts as one attempt', async () => {
    const engine = makeEngine()
    const task = await makeTask()
    // invalid-result consumes the runner's inner retry; the engine sees one
    // successful dispatch and exactly one attempt row.
    await queueModes(task, ['invalid-result', 'ok'])

    await walkOneStage(engine)

    expect((await reload(db, task.id)).status).toBe('spec_review')
    const rows = await db.select().from(stages).where(eq(stages.taskId, task.id))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.attempt).toBe(0)
    expect(rows[0]?.status).toBe('succeeded')
  })

  test('a blocking decision parks the task; discussion stays inert until a confirmed proposal resumes it, and the next prompt carries the outcome but not the transcript', async () => {
    const engine = makeEngine()
    const task = await makeTask()
    await queueModes(task, ['needs-decision'])

    await walkOneStage(engine)
    expect((await reload(db, task.id)).status).toBe('waiting_human')

    const [decision] = await db.select().from(decisions).where(eq(decisions.taskId, task.id))
    assert(decision)
    expect(decision).toMatchObject({
      status: 'open',
      blocking: true,
      nodeKey: 'research',
      key: 'scope',
    })

    const [conversation] = await db
      .select()
      .from(conversations)
      .where(
        and(eq(conversations.subjectKind, 'decision'), eq(conversations.subjectId, decision.id)),
      )
    assert(conversation)

    // The owner discusses the question; a plain follow-up never resumes the task.
    const store = createConversationStore(db)
    await appendOwnerMessage(store, {
      conversationId: conversation.id,
      content: 'What does the repository currently cover?',
      idempotencyKey: crypto.randomUUID(),
    })
    await queueModes(task, ['conversation'])
    expect(await engine.tick()).toBe(1)
    await engine.idle()
    expect((await reload(db, task.id)).status).toBe('waiting_human')
    expect(
      (await db.select().from(decisions).where(eq(decisions.id, decision.id)))[0]?.status,
    ).toBe('open')

    // The guide proposes an answer; a proposal is not consent either.
    await appendOwnerMessage(store, {
      conversationId: conversation.id,
      content: 'What should the answer be?',
      idempotencyKey: crypto.randomUUID(),
    })
    await queueModes(task, ['conversation-answer-decision'])
    expect(await engine.tick()).toBe(1)
    await engine.idle()

    const [proposed] = await db
      .select()
      .from(conversationActions)
      .where(
        and(
          eq(conversationActions.conversationId, conversation.id),
          eq(conversationActions.kind, 'answer_decision'),
        ),
      )
    assert(proposed)
    expect(proposed.status).toBe('proposed')
    expect((await reload(db, task.id)).status).toBe('waiting_human')
    expect(
      (await db.select().from(decisions).where(eq(decisions.id, decision.id)))[0]?.status,
    ).toBe('open')

    // Confirming the proposal — not the discussion — is what resolves it.
    await engine.confirmAction({
      taskId: task.id,
      actionId: proposed.id,
      actor: 'owner',
      idempotencyKey: `confirm:${proposed.id}`,
    })
    expect((await reload(db, task.id)).status).toBe('research')
    const resolved = (await db.select().from(decisions).where(eq(decisions.id, decision.id)))[0]
    expect(resolved).toMatchObject({ status: 'answered', answerMd: 'The whole repository.' })

    // The next run at that node sees the outcome, never the conversation.
    const record = join(await tempDir('stub-record'), 'invocation.json')
    await queueModes(task, ['ok'], { record })
    await walkOneStage(engine)
    expect((await reload(db, task.id)).status).toBe('spec_review')
    const invocation = JSON.parse(await readFile(record, 'utf8')) as { prompt: string }
    expect(invocation.prompt).toContain('What does this cover?')
    expect(invocation.prompt).toContain('The whole repository.')
    expect(invocation.prompt).not.toContain('What does the repository currently cover?')
    expect(invocation.prompt).not.toContain('I recommend')
  })

  test('a spec loop that exhausts its cap with no agent request raises an escalation naming it, and answering resumes the task', async () => {
    const engine = makeEngine()
    const task = await makeTask()
    await db.insert(iterations).values([
      { taskId: task.id, loop: 'spec', round: 1, reviewerVerdict: 'revise', findings: [] },
      { taskId: task.id, loop: 'spec', round: 2, reviewerVerdict: 'revise', findings: [] },
      { taskId: task.id, loop: 'spec', round: 3, reviewerVerdict: 'revise', findings: [] },
    ])
    await db.update(tasks).set({ status: 'spec_review' }).where(eq(tasks.id, task.id))
    await queueModes(task, ['revise'])

    await walkOneStage(engine)

    expect((await reload(db, task.id)).status).toBe('waiting_human')
    const [decision] = await db
      .select()
      .from(decisions)
      .where(and(eq(decisions.taskId, task.id), eq(decisions.kind, 'escalation')))
    assert(decision)
    expect(decision.blocking).toBe(true)
    expect(decision.promptMd).toContain('spec')
    expect(decision.promptMd).toContain('3')

    const resumed = await engine.answer({
      taskId: task.id,
      decisionId: decision.id,
      actor: 'evgeny',
      text: 'Proceed to implement anyway.',
    })
    expect(resumed.status).toBe('spec_review')
  })

  async function makeKickoffTask(): Promise<Task> {
    const slug = `e2e-kickoff-${crypto.randomUUID().slice(0, 8)}`
    const { task } = await createTask(db, {
      slug,
      title: `E2E ${slug}`,
      type: 'feature',
      repoUrl: originUrl,
      at: 'planning',
    })
    created.push(task.id)

    return task
  }

  test('a task walks planning → kickoff_brief → the kickoff gate: the brief is complete, and its questions are open and discussable without being resolved', async () => {
    const engine = makeEngine()
    const task = await makeKickoffTask()
    await queueModes(task, ['brief-complete', 'brief-complete-questions'])

    await walkOneStage(engine)
    expect((await reload(db, task.id)).status).toBe('kickoff_brief')

    await walkOneStage(engine)
    expect((await reload(db, task.id)).status).toBe('human_kickoff_gate')

    const openDecisions = await db
      .select()
      .from(decisions)
      .where(and(eq(decisions.taskId, task.id), eq(decisions.status, 'open')))
    expect(openDecisions.map((d) => d.key).sort()).toEqual(['auth-scope', 'data-retention'])
    expect(openDecisions.every((d) => d.blocking === false && d.nodeKey === 'kickoff_brief')).toBe(
      true,
    )

    // Every question opened its own scoped, discussable conversation.
    const scoped = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.taskId, task.id),
          inArray(
            conversations.subjectId,
            openDecisions.map((d) => d.id),
          ),
        ),
      )
    expect(scoped).toHaveLength(2)
    expect(scoped.every((c) => c.subjectKind === 'decision')).toBe(true)

    const briefPath = join(
      worktreePath(resolveWorkspaceConfig({ root }), task.slug),
      'openspec/changes',
      task.slug,
      'proposal.md',
    )
    const brief = await readFile(briefPath, 'utf8')
    expect(brief).toContain('## Key Points')
    expect(brief).toContain('## Open Questions')
  })

  test('a kickoff redirect carries the comment back to planning; approving afterward starts research with no open question', async () => {
    const engine = makeEngine()
    const task = await makeKickoffTask()
    await queueModes(task, ['brief-complete', 'brief-complete-questions'])
    await walkOneStage(engine)
    await walkOneStage(engine)
    expect((await reload(db, task.id)).status).toBe('human_kickoff_gate')

    await engine.redirect(task.id, 'evgeny', 'Please reconsider the auth scope before drafting.')
    expect((await reload(db, task.id)).status).toBe('planning')

    const record = join(await tempDir('stub-record'), 'invocation.json')
    await queueModes(task, ['brief-complete'], { record })
    await walkOneStage(engine)
    expect((await reload(db, task.id)).status).toBe('kickoff_brief')
    const invocation = JSON.parse(await readFile(record, 'utf8')) as { prompt: string }
    expect(invocation.prompt).toContain('Please reconsider the auth scope before drafting.')

    await queueModes(task, ['brief-complete-questions'])
    await walkOneStage(engine)
    expect((await reload(db, task.id)).status).toBe('human_kickoff_gate')

    await engine.approve(task.id, 'evgeny')
    expect((await reload(db, task.id)).status).toBe('research')
    const stillOpen = await db
      .select()
      .from(decisions)
      .where(and(eq(decisions.taskId, task.id), eq(decisions.status, 'open')))
    expect(stillOpen).toHaveLength(0)
  })

  test('missing coverage: the brief carries the warning, discussing changes nothing, proceeding waives it and starts research with the waiver in its ledger — AC-1404, AC-1407, AC-1408, AC-1414, AC-1417', async () => {
    const engine = makeEngine()
    const task = await makeKickoffTask()
    await queueModes(task, ['brief-complete-harness-gap', 'brief-complete-harness-gap'])

    await walkOneStage(engine)
    expect((await reload(db, task.id)).status).toBe('kickoff_brief')
    expect((await reload(db, task.id)).harnessStatus).toBe('missing')

    await walkOneStage(engine)
    expect((await reload(db, task.id)).status).toBe('human_kickoff_gate')

    const briefPath = join(
      worktreePath(resolveWorkspaceConfig({ root }), task.slug),
      'openspec/changes',
      task.slug,
      'proposal.md',
    )
    const brief = await readFile(briefPath, 'utf8')
    expect(brief).toContain('Harness gap:')

    const [decision] = await db
      .select()
      .from(decisions)
      .where(
        and(
          eq(decisions.taskId, task.id),
          eq(decisions.nodeKey, 'human_kickoff_gate'),
          eq(decisions.key, 'harness-coverage'),
        ),
      )
    assert(decision)
    expect(decision.status).toBe('open')
    expect(decision.options.map((o) => o.id).sort()).toEqual(['cancel', 'proceed', 'split'])

    // Discussing (or simply not yet answering) changes neither the decision nor the task.
    expect((await reload(db, task.id)).harnessStatus).toBe('missing')
    expect((await reload(db, task.id)).status).toBe('human_kickoff_gate')

    await engine.answer({
      taskId: task.id,
      decisionId: decision.id,
      actor: 'evgeny',
      optionId: 'proceed',
    })
    expect((await reload(db, task.id)).harnessStatus).toBe('waived')
    expect((await reload(db, task.id)).status).toBe('human_kickoff_gate')

    const record = join(await tempDir('stub-record'), 'research-invocation.json')
    await queueModes(task, ['ok'], { record })
    await engine.approve(task.id, 'evgeny')
    expect((await reload(db, task.id)).status).toBe('research')

    await walkOneStage(engine)
    expect((await reload(db, task.id)).status).toBe('spec_review')
    const invocation = JSON.parse(await readFile(record, 'utf8')) as { prompt: string }
    expect(invocation.prompt).toContain('Harness coverage: waived')
  })

  test('split instead: a harness task is created, the original blocks, the harness task archives, the original re-enters planning and is classified again — AC-1411, AC-1412, AC-627', async () => {
    const engine = makeEngine()
    const task = await makeKickoffTask()
    await queueModes(task, ['brief-complete-harness-gap', 'brief-complete-harness-gap'])

    await walkOneStage(engine)
    await walkOneStage(engine)
    expect((await reload(db, task.id)).status).toBe('human_kickoff_gate')

    const [decision] = await db
      .select()
      .from(decisions)
      .where(
        and(
          eq(decisions.taskId, task.id),
          eq(decisions.nodeKey, 'human_kickoff_gate'),
          eq(decisions.key, 'harness-coverage'),
          eq(decisions.status, 'open'),
        ),
      )
    assert(decision)

    await engine.answer({
      taskId: task.id,
      decisionId: decision.id,
      actor: 'evgeny',
      optionId: 'split',
    })

    const blocked = await reload(db, task.id)
    expect(blocked.status).toBe('blocked')
    expect(blocked.blockedBy).toHaveLength(1)
    const harnessTaskId = blocked.blockedBy[0]
    assert(harnessTaskId)
    created.push(harnessTaskId)
    const [harnessTask] = await db.select().from(tasks).where(eq(tasks.id, harnessTaskId))
    assert(harnessTask)
    expect(harnessTask.description).toContain('No state-level suite exercises the redirect')

    // The harness task's own walk through its pipeline is exercised by the
    // other e2e cases in this file; here only its terminal transition
    // matters, so it is placed at the final gate directly.
    await db.update(tasks).set({ status: 'human_final_gate' }).where(eq(tasks.id, harnessTaskId))
    await engine.approve(harnessTaskId, 'evgeny')
    expect((await reload(db, harnessTaskId)).status).toBe('archived')

    const released = await reload(db, task.id)
    expect(released.status).toBe('planning')
    expect(released.blockedBy).toEqual([])

    await queueModes(task, ['brief-complete'])
    await walkOneStage(engine)
    const reclassified = await reload(db, task.id)
    expect(reclassified.status).toBe('kickoff_brief')
    expect(reclassified.harnessStatus).toBe('adequate')
    const openAfterRelease = await db
      .select()
      .from(decisions)
      .where(
        and(
          eq(decisions.taskId, task.id),
          eq(decisions.nodeKey, 'human_kickoff_gate'),
          eq(decisions.key, 'harness-coverage'),
          eq(decisions.status, 'open'),
        ),
      )
    expect(openAfterRelease).toEqual([])
  })
})
