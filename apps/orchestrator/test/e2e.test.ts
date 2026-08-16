import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createDb, type Database, stages, type Task, tasks } from '@specmate/db'
import {
  ClaudeCodeProvider,
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
import { asc, eq, inArray } from 'drizzle-orm'
import {
  cleanupTempDirs,
  makeHarness,
  STUB,
  STUB_ENV,
  setStubEnv,
  tempDir,
} from '../../../packages/runner/test/fixtures.ts'
import { Engine, type StageDispatcher } from '../src/engine.ts'
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

  function makeEngine() {
    const manager = new WorkspaceManager({ config: { root } })
    const config = resolveRunnerConfig({
      backend: 'local',
      cli: STUB,
      rolesDir: join(import.meta.dir, '../../../roles'),
      stageTimeoutMs: 20_000,
      forwardEnv: STUB_ENV,
    })
    const backend = new LocalBackend(config)
    const service = new WorkspaceService(manager, db, (workspace, image) =>
      backend.resolveEnvironment(workspace.path, image),
    )
    const executor = new StageExecutor({
      config,
      provider: new ClaudeCodeProvider({ config, backend }),
      git: new Git(manager.config),
      workspaces: service,
      ledger: (taskId) => renderLedgerForTask(db, config, taskId),
    })
    const dispatcher: StageDispatcher = async ({ task, node, stageId, attempt, workspace }) => {
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

    return new Engine({
      db,
      workspaces: {
        provision: (request) => service.provision({ ...request, image: config.image }),
        discard: (workspace) => service.discard(workspace),
        release: (taskId) => service.release(taskId),
      },
      settings: { stageConcurrency: 1, stageAttemptCap: 2, availableProviders: ['claude-code'] },
      dispatcher,
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

  async function queueModes(task: Task, modes: string[]): Promise<void> {
    const queue = join(await tempDir('stub-queue'), 'modes.json')
    await writeFile(queue, JSON.stringify(modes))
    setStubEnv({ SPECMATE_STUB_MODE_FILE: queue, SPECMATE_STUB_SLUG: task.slug })
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
})
