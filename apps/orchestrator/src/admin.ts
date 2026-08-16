/**
 * The programmatic gate operations and dev task creation, callable before any
 * UI exists. Phase 2 wraps the same engine operations in decision cards; this
 * entry point must not grow transitions of its own.
 *
 *   bun apps/orchestrator/src/admin.ts create --slug s --title t --type feature --repo <url> [--at research]
 *   bun apps/orchestrator/src/admin.ts approve|redirect|rework|resume|restart|cancel --task <uuid> [...]
 *   bun apps/orchestrator/src/admin.ts show --task <uuid>
 */

import { TaskState } from '@specmate/core'
import { createDb, databaseUrl, stages, tasks } from '@specmate/db'
import { WorkspaceManager, WorkspaceService } from '@specmate/workspace'
import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { Engine } from './engine.ts'
import { createTask, latestGraph } from './store.ts'

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`)

  return at === -1 ? undefined : process.argv[at + 1]
}

function required(name: string): string {
  const value = flag(name)
  if (!value) {
    console.error(`--${name} is required`)
    process.exit(2)
  }

  return value
}

// WORKSPACE_ROOT is required, not defaulted: terminal gate operations release
// worktrees, and a cwd-relative default here would silently miss the root the
// daemon actually uses.
const parsed = z
  .object({
    WORKSPACE_ROOT: z.string().min(1),
    GIT_AUTHOR_NAME: z.string().min(1).default('SpecMate'),
    GIT_AUTHOR_EMAIL: z.string().min(1).default('specmate@localhost'),
    STAGE_CONCURRENCY: z.coerce.number().int().positive().default(1),
    STAGE_ATTEMPT_CAP: z.coerce.number().int().positive().default(2),
  })
  .safeParse(process.env)
if (!parsed.success) {
  console.error(
    `invalid environment (WORKSPACE_ROOT must match the daemon's):\n${z.prettifyError(parsed.error)}`,
  )
  process.exit(1)
}
const env = parsed.data

const db = createDb(databaseUrl())
const manager = new WorkspaceManager({
  config: {
    root: env.WORKSPACE_ROOT,
    authorName: env.GIT_AUTHOR_NAME,
    authorEmail: env.GIT_AUTHOR_EMAIL,
  },
})

// Ops-only engine: no dispatcher, so it can approve and park but never run a
// stage — the admin entry decides state, the orchestrator process does work.
const service = new WorkspaceService(manager, db, () => {
  return Promise.reject(new Error('the admin entry never provisions workspaces'))
})
const engine = new Engine({
  db,
  workspaces: {
    provision: () => Promise.reject(new Error('the admin entry never provisions workspaces')),
    discard: (workspace) => service.discard(workspace),
    release: (taskId) => service.release(taskId),
  },
  settings: {
    stageConcurrency: env.STAGE_CONCURRENCY,
    stageAttemptCap: env.STAGE_ATTEMPT_CAP,
    availableProviders: ['claude-code'],
  },
  log: (message) => console.error(message),
})

const actor = flag('actor') ?? 'admin'
const command = process.argv[2]

try {
  switch (command) {
    case 'create': {
      const at = flag('at')
      const { task, graph } = await createTask(db, {
        slug: required('slug'),
        title: required('title'),
        type: required('type'),
        repoUrl: required('repo'),
        baseBranch: flag('base'),
        at: at ? TaskState.parse(at) : undefined,
      })
      console.info(JSON.stringify({ task, graphVersion: graph.version }, null, 2))
      break
    }
    case 'approve': {
      await engine.approve(required('task'), actor)
      break
    }
    case 'redirect': {
      await engine.redirect(required('task'), actor, flag('comment'))
      break
    }
    case 'rework': {
      await engine.rework(required('task'), actor, TaskState.parse(required('to')))
      break
    }
    case 'resume': {
      await engine.resume(required('task'), actor)
      break
    }
    case 'restart': {
      const to = flag('to')
      await engine.restart(required('task'), actor, to ? TaskState.parse(to) : undefined)
      break
    }
    case 'cancel': {
      await engine.cancel(required('task'), actor)
      break
    }
    case 'show': {
      const taskId = required('task')
      const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1)
      if (!task) {
        console.error(`task ${taskId} does not exist`)
        process.exit(1)
      }
      const graph = await latestGraph(db, taskId)
      const attempts = await db
        .select({
          nodeKey: stages.nodeKey,
          attempt: stages.attempt,
          status: stages.status,
          provider: stages.provider,
        })
        .from(stages)
        .where(eq(stages.taskId, taskId))
        .orderBy(asc(stages.createdAt))
      console.info(JSON.stringify({ task, graphVersion: graph?.version, attempts }, null, 2))
      break
    }
    default: {
      console.error(
        'usage: admin.ts <create|approve|redirect|rework|resume|restart|cancel|show> [--flags]',
      )
      process.exit(2)
    }
  }
} catch (e) {
  console.error((e as Error).message)
  process.exit(1)
}

if (command !== 'create' && command !== 'show') {
  const taskId = required('task')
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1)
  console.info(JSON.stringify({ id: task?.id, status: task?.status }, null, 2))
}
process.exit(0)
