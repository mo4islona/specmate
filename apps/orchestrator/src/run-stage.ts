/**
 * Runs one stage end to end, without the loop. This is how a change to prompts,
 * to the runner image, or to a provider is verified against a real repository
 * before the state machine exists to schedule it.
 *
 *   bun apps/orchestrator/src/run-stage.ts --task <uuid> --role researcher
 */

import { AgentRole } from '@specmate/core'
import { createDb, databaseUrl, tasks } from '@specmate/db'
import { renderLedgerForTask, StageExecutor } from '@specmate/runner'
import { Git, WorkspaceManager, WorkspaceService } from '@specmate/workspace'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import {
  backendFor,
  providerFor,
  RunnerEnv,
  runnerConfigFrom,
  taskRunnerEnvironment,
} from './runner.ts'

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`)

  return at === -1 ? undefined : process.argv[at + 1]
}

const taskId = flag('task')
const role = AgentRole.safeParse(flag('role'))
if (!taskId || !role.success) {
  console.error('usage: run-stage.ts --task <uuid> --role <agent role>')
  process.exit(2)
}

const env = RunnerEnv.extend({
  WORKSPACE_ROOT: z.string().min(1).default('workspaces'),
  GIT_AUTHOR_NAME: z.string().min(1).default('SpecMate'),
  GIT_AUTHOR_EMAIL: z.string().min(1).default('specmate@localhost'),
  NODE_ENV: z.string().min(1).default('development'),
}).parse(process.env)

const db = createDb(databaseUrl())
const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1)
if (!task) {
  console.error(`task ${taskId} does not exist`)
  process.exit(1)
}

const manager = new WorkspaceManager({
  config: {
    root: env.WORKSPACE_ROOT,
    authorName: env.GIT_AUTHOR_NAME,
    authorEmail: env.GIT_AUTHOR_EMAIL,
  },
})
const config = runnerConfigFrom(env, env.NODE_ENV)
const backend = backendFor(config)
const workspaces = new WorkspaceService(manager, db, (workspace, image) =>
  backend.resolveEnvironment(workspace.path, image),
)
const workspace = await workspaces.provision({
  taskId: task.id,
  slug: task.slug,
  repoUrl: task.repoUrl,
  baseBranch: task.baseBranch ?? undefined,
  image: config.image,
})
const [provisionedTask] = await db.select().from(tasks).where(eq(tasks.id, task.id)).limit(1)
if (!provisionedTask) {
  console.error(`task ${task.id} disappeared during workspace provision`)
  process.exit(1)
}

const executor = new StageExecutor({
  config,
  provider: providerFor(config, backend),
  git: new Git(manager.config),
  workspaces,
  ledger: (id) => renderLedgerForTask(db, config, id),
})

const binding = provisionedTask.modelBindings[role.data]

const execution = await executor.execute({
  taskId: task.id,
  stageId: crypto.randomUUID(),
  role: role.data,
  model: binding.model,
  reasoningEffort: binding.reasoningEffort,
  workspace,
  baseBranch: workspace.baseBranch,
  environment: taskRunnerEnvironment(provisionedTask.environment),
})

console.info(JSON.stringify(execution, null, 2))
process.exit(execution.status === 'succeeded' ? 0 : 1)
