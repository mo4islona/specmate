import { createDb, databaseUrl, ping } from '@specmate/db'
import { WorkspaceManager } from '@specmate/workspace'
import { z } from 'zod'
import { backendFor, RunnerEnv, runnerConfigFrom } from './runner.ts'

/** Docker/`.env` supply unset variables as empty strings; treat those as absent. */
const optionalString = z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional())

const Env = z.object({
  DATABASE_URL: z.string().min(1),
  ORCHESTRATOR_PORT: z.coerce.number().int().positive().default(4100),
  /** How often the (currently empty) work loop wakes up. */
  TICK_INTERVAL_MS: z.coerce.number().int().positive().default(5_000),
  /** Root holding repository mirrors and per-task worktrees. */
  WORKSPACE_ROOT: z.string().min(1).default('workspaces'),
  GIT_AUTHOR_NAME: z.string().min(1).default('SpecMate'),
  GIT_AUTHOR_EMAIL: z.string().min(1).default('specmate@localhost'),
  /** Read-only key for target repositories; absent is legal for public origins. */
  REPO_SSH_KEY_PATH: optionalString,
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
    sshKeyPath: env.REPO_SSH_KEY_PATH,
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
try {
  const runner = runnerConfigFrom(env, env.NODE_ENV)
  const report = await backendFor(runner).preflight(workspaces.config.root)
  console.info(`runner ready — ${report}`)
} catch (e) {
  console.error(`runner preflight failed: ${(e as Error).message}`)
  process.exit(1)
}

// Phase 1: the loop proves the process boots, holds a DB connection and shuts
// down cleanly. The state machine lands with the orchestrator-loop change.
let ticks = 0
let healthy = false

async function tick(): Promise<void> {
  healthy = await ping(db).catch(() => false)
  ticks += 1
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
