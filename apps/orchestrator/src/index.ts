import { join } from 'node:path'
import { PIPELINE_CATALOG } from '@specmate/core'
import { createDb, databaseUrl, ping, tasks } from '@specmate/db'
import {
  ConversationExecutor,
  killContainersByLabels,
  killLocalAgents,
  renderLedgerForTask,
  StageExecutor,
} from '@specmate/runner'
import { Git, WorkspaceManager, WorkspaceService } from '@specmate/workspace'
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { createConversationDispatcher, createStageDispatcher } from './dispatch.ts'
import { Engine, type EngineWorkspaces } from './engine.ts'
import { githubToken } from './github-auth.ts'
import { Publisher } from './publish.ts'
import {
  backendFor,
  providerFor,
  RunnerEnv,
  runnerConfigFrom,
  taskRunnerEnvironment,
} from './runner.ts'
import { emitEvent } from './store.ts'

/** Docker/`.env` supply unset variables as empty strings; treat those as absent. */
const optionalString = z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional())

const Env = z.object({
  DATABASE_URL: z.string().min(1),
  ORCHESTRATOR_PORT: z.coerce.number().int().positive().default(4100),
  /** How often the work loop polls for runnable tasks. */
  TICK_INTERVAL_MS: z.coerce.number().int().positive().default(5_000),
  /** Stages in flight at once, across tasks — never more than one per task. */
  STAGE_CONCURRENCY: z.coerce.number().int().positive().default(1),
  /** Read-only conversation turns have their own global pool. */
  CONVERSATION_CONCURRENCY: z.coerce.number().int().positive().default(2),
  /** Dispatches per stage before the task fails naming it (the runner's inner retry is separate). */
  STAGE_ATTEMPT_CAP: z.coerce.number().int().positive().default(2),
  /** Root holding repository mirrors and per-task worktrees. */
  WORKSPACE_ROOT: z.string().min(1).default('workspaces'),
  GIT_AUTHOR_NAME: z.string().min(1).default('SpecMate'),
  GIT_AUTHOR_EMAIL: z.string().min(1).default('specmate@localhost'),
  /** Public OAuth application identifier; authorization state is stored in the database. */
  GITHUB_APP_CLIENT_ID: optionalString,
  NODE_ENV: z.string().min(1).default('development'),
  ...RunnerEnv.shape,
})

const parsed = Env.safeParse(process.env)
if (!parsed.success) {
  console.error(`invalid environment:\n${z.prettifyError(parsed.error)}`)
  process.exit(1)
}
const env = parsed.data
const db = createDb(databaseUrl())

const workspaces = new WorkspaceManager({
  config: {
    root: env.WORKSPACE_ROOT,
    authorName: env.GIT_AUTHOR_NAME,
    authorEmail: env.GIT_AUTHOR_EMAIL,
    githubToken: () => githubToken({ db, clientId: env.GITHUB_APP_CLIENT_ID }),
  },
})

// A process that cannot run git cannot run a single stage; better to refuse to
// start than to fail every task it picks up.
try {
  const { root, gitVersion } = await workspaces.preflight()
  console.info(`workspaces ready at ${root} (${gitVersion})`)
} catch (e) {
  console.error(`workspace preflight failed: ${(e as Error).message}`)
  process.exit(1)
}

// The same reasoning for the executor: no isolation runtime, no stages. This
// also proves that a path means the same thing here and on the host, which is
// the failure that would otherwise show up as an agent seeing an empty repository.
const pidDir = join(workspaces.config.root, 'agent-pids')
let runnerConfig: ReturnType<typeof runnerConfigFrom>
let backend: ReturnType<typeof backendFor>
try {
  runnerConfig = runnerConfigFrom(env, env.NODE_ENV, pidDir)
  backend = backendFor(runnerConfig)
  const report = await backend.preflight(workspaces.config.root)
  console.info(`runner ready — ${report}`)
} catch (e) {
  console.error(`runner preflight failed: ${(e as Error).message}`)
  process.exit(1)
}

// Catalog ⊆ enum is a coupling that must fail at startup, never mid-task: a
// definition whose node keys the database cannot store is a missing migration.
try {
  const rows = (await db.execute(
    sql`select unnest(enum_range(null::task_status))::text as value`,
  )) as { value: string }[]
  const known = new Set(rows.map((row) => row.value))
  const missing = [
    ...new Set(
      Object.values(PIPELINE_CATALOG)
        .flatMap((def) => def.nodes.map((node) => node.key))
        .filter((key) => !known.has(key)),
    ),
  ]
  if (missing.length > 0) {
    console.error(
      `the task_status enum is missing values the pipeline catalog requires: ${missing.join(', ')} — write the migration that adds them`,
    )
    process.exit(1)
  }
} catch (e) {
  console.error(`task_status enum check failed: ${(e as Error).message}`)
  process.exit(1)
}

const service = new WorkspaceService(workspaces, db, (workspace, image) =>
  backend.resolveEnvironment(workspace.path, image),
)
const publisher = new Publisher({
  db,
  git: new Git(workspaces.config),
  workspaceConfig: workspaces.config,
  token: () => githubToken({ db, clientId: env.GITHUB_APP_CLIENT_ID }),
})
const provider = providerFor(runnerConfig, backend)
// Best-effort but ordered: chained rather than fire-and-forget, so concurrent
// inserts can't commit out of the order the tool uses actually happened in —
// `events.seq` is what the SSE stream's cursor advances on. A dropped event
// must still never take down the run it describes, so each link swallows its
// own error rather than letting one failed write break the chain.
let activityChain: Promise<unknown> = Promise.resolve()
const executor = new StageExecutor({
  config: runnerConfig,
  provider,
  git: new Git(workspaces.config),
  workspaces: service,
  ledger: (taskId) => renderLedgerForTask(db, runnerConfig, taskId),
  deferCommit: true,
  onActivity: (activity) => {
    activityChain = activityChain.then(() =>
      emitEvent(db, {
        taskId: activity.taskId,
        stageId: activity.stageId,
        type: 'stage.activity',
        payload: { attempt: activity.attempt, tool: activity.tool, target: activity.target },
      }).catch((e: Error) =>
        console.error(`activity event for stage ${activity.stageId}: ${e.message}`),
      ),
    )
  },
})
const conversationExecutor = new ConversationExecutor({
  config: runnerConfig,
  provider,
  git: new Git(workspaces.config),
  ledger: (taskId) => renderLedgerForTask(db, runnerConfig, taskId),
})

// The engine names tasks, not images: the default image joins here so the
// service can pin the environment on first provision.
const engineWorkspaces: EngineWorkspaces = {
  provision: (request) => service.provision({ ...request, image: runnerConfig.image }),
  provisionConversation: (workspace, key) => service.provisionConversation(workspace, key),
  releaseConversation: (task, key) => service.releaseConversation(task.slug, task.repoUrl, key),
  discard: (workspace, commit) => service.discard(workspace, commit),
  headCommit: (workspace) => service.headCommit(workspace),
  commitStage: (taskId, workspace, stage) => service.commitStage(taskId, workspace, stage),
  writeDecisionLog: (workspace, markdown) => service.writeDecisionLog(workspace, markdown),
  countSpecScenarios: (workspace) => service.countSpecScenarios(workspace),
  release: (taskId) => service.release(taskId),
}

/**
 * The environment is pinned during provision, moments after the tick took its task
 * snapshot — dispatch on the pin, not on the snapshot.
 */
const pinnedEnvironment = async (taskId: string) => {
  const [current] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1)

  return taskRunnerEnvironment(current?.environment ?? null)
}

const dispatcher = createStageDispatcher({ executor, pinnedEnvironment })

const conversationDispatcher = createConversationDispatcher({
  executor: conversationExecutor,
  pinnedEnvironment,
})

const engine = new Engine({
  db,
  workspaces: engineWorkspaces,
  settings: {
    stageConcurrency: env.STAGE_CONCURRENCY,
    conversationConcurrency: env.CONVERSATION_CONCURRENCY,
    stageAttemptCap: env.STAGE_ATTEMPT_CAP,
    availableProviders: ['claude-code'],
  },
  dispatcher,
  actionDispatcher: ({ task, graph, node }) => publisher.run(task, graph, node),
  conversationDispatcher,
  // Local agents are detached children that survive a crash exactly like a
  // container does; both backends leave something the sweep must kill.
  killOrphans:
    runnerConfig.backend === 'docker'
      ? (labels) => killContainersByLabels(runnerConfig, labels)
      : (labels) => killLocalAgents(pidDir, labels),
  log: (message) => console.info(message),
})

// Recovery before the first dispatch: whatever a previous process left
// recorded as running is settled from the store alone.
try {
  const swept = await engine.sweep()
  if (swept > 0) console.info(`sweep settled ${swept} orphaned execution attempt(s)`)
} catch (e) {
  console.error(`startup sweep failed: ${(e as Error).message}`)
  process.exit(1)
}

let ticks = 0
let healthy = false
let working = false

async function tick(): Promise<void> {
  healthy = await ping(db).catch(() => false)
  ticks += 1
  if (working || !healthy) return

  working = true
  try {
    await engine.tick()
  } catch (e) {
    console.error(`tick failed: ${(e as Error).message}`)
  } finally {
    working = false
  }
}

await tick()

const timer = setInterval(() => void tick(), env.TICK_INTERVAL_MS)

const server = Bun.serve({
  port: env.ORCHESTRATOR_PORT,
  fetch(req) {
    const { pathname } = new URL(req.url)
    if (pathname === '/healthz') return Response.json({ ok: true })
    if (pathname === '/readyz') {
      return Response.json({ ok: healthy, ticks }, { status: healthy ? 200 : 503 })
    }
    return new Response('not found', { status: 404 })
  },
})

console.info(`specmate orchestrator listening on ${server.url}`)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.info(`${signal} received, stopping orchestrator`)
    clearInterval(timer)
    void server.stop(false).then(() => process.exit(0))
  })
}
