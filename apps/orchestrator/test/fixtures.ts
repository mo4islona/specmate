import { type Caps, StageResult, type TaskState } from '@specmate/core'
import type { Database, Task } from '@specmate/db'
import { tasks } from '@specmate/db'
import type { ConversationExecution, StageExecution } from '@specmate/runner'
import type { ConversationWorkspace, Workspace } from '@specmate/workspace'
import { eq } from 'drizzle-orm'
import type {
  ConversationDispatch,
  ConversationDispatcher,
  EngineWorkspaces,
  StageDispatch,
  StageDispatcher,
} from '../src/engine.ts'
import { createTask, type RunGraphRow } from '../src/store.ts'

export interface FakeWorkspaces {
  readonly calls: {
    provisioned: string[]
    conversationProvisioned: string[]
    conversationReleased: string[]
    discarded: string[]
    released: string[]
    decisionLogs: { slug: string; markdown: string }[]
  }
  readonly workspaces: EngineWorkspaces
  failNextConversationRelease(error?: Error): void
}

/** In-memory stand-in: the engine's workspace contract without git or disk. */
export function fakeWorkspaces(): FakeWorkspaces {
  const calls = {
    provisioned: [] as string[],
    conversationProvisioned: [] as string[],
    conversationReleased: [] as string[],
    discarded: [] as string[],
    released: [] as string[],
    decisionLogs: [] as { slug: string; markdown: string }[],
  }
  const workspace = (slug: string): Workspace => ({
    slug,
    repoUrl: 'file:///dev/null',
    branch: `task/${slug}`,
    path: `/tmp/fake/${slug}`,
    changeDir: `openspec/changes/${slug}`,
    mirrorPath: '/tmp/fake-mirror',
  })
  let conversationReleaseFailure: Error | undefined

  return {
    calls,
    failNextConversationRelease(error = new Error('conversation cleanup failed')) {
      conversationReleaseFailure = error
    },
    workspaces: {
      async provision(request) {
        calls.provisioned.push(request.slug)
        return workspace(request.slug)
      },
      async provisionConversation(primary, key): Promise<ConversationWorkspace> {
        calls.conversationProvisioned.push(key)
        return {
          ...primary,
          kind: 'conversation',
          key,
          sourceBranch: primary.branch,
          branch: 'fake-conversation-head',
          path: `${primary.path}/conversations/${key}`,
        }
      },
      async releaseConversation(_task, key) {
        calls.conversationReleased.push(key)
        if (conversationReleaseFailure) {
          const error = conversationReleaseFailure
          conversationReleaseFailure = undefined
          throw error
        }
      },
      async discard(ws) {
        calls.discarded.push(ws.slug)
      },
      async writeDecisionLog(ws, markdown) {
        calls.decisionLogs.push({ slug: ws.slug, markdown })
      },
      async release(taskId) {
        calls.released.push(taskId)
      },
    },
  }
}

export interface FakeDispatcher {
  readonly dispatches: StageDispatch[]
  readonly dispatcher: StageDispatcher
  plan(next: (dispatch: StageDispatch) => Promise<StageExecution> | StageExecution): void
}

export function fakeDispatcher(): FakeDispatcher {
  const dispatches: StageDispatch[] = []
  let next: (dispatch: StageDispatch) => Promise<StageExecution> | StageExecution = () =>
    okExecution('researcher')

  return {
    dispatches,
    plan(fn) {
      next = fn
    },
    dispatcher: async (dispatch) => {
      dispatches.push(dispatch)
      return next(dispatch)
    },
  }
}

export interface FakeConversationDispatcher {
  readonly dispatches: ConversationDispatch[]
  readonly dispatcher: ConversationDispatcher
  plan(
    next: (
      dispatch: ConversationDispatch,
    ) => Promise<ConversationExecution> | ConversationExecution,
  ): void
}

export function fakeConversationDispatcher(): FakeConversationDispatcher {
  const dispatches: ConversationDispatch[] = []
  let next: (
    dispatch: ConversationDispatch,
  ) => Promise<ConversationExecution> | ConversationExecution = () => okConversationExecution()

  return {
    dispatches,
    plan(fn) {
      next = fn
    },
    dispatcher: async (dispatch) => {
      dispatches.push(dispatch)

      return next(dispatch)
    },
  }
}

export function okExecution(
  role: string,
  overrides: Partial<StageExecution> & { verdict?: string; findings?: unknown[] } = {},
): StageExecution {
  const { verdict, findings, ...execution } = overrides

  return {
    status: 'succeeded',
    attempts: [{ attempt: 0, ok: true, durationMs: 5 }],
    result: StageResult.parse({
      schema_version: 1,
      role,
      status: 'ok',
      ...(verdict ? { verdict } : {}),
      ...(findings ? { findings } : {}),
    }),
    telemetry: {
      model: 'stub-model-1',
      tokens: { input_tokens: 1200, output_tokens: 340 },
      costUsd: 0.42,
      raw: { type: 'result' },
    },
    ...execution,
  }
}

export function failedExecution(failure = 'provider_error', detail = 'boom'): StageExecution {
  return {
    status: 'failed',
    attempts: [{ attempt: 0, ok: false, durationMs: 5 }],
    failure: failure as StageExecution['failure'],
    detail,
  }
}

export function okConversationExecution(message = 'The fixture response.'): ConversationExecution {
  return {
    status: 'succeeded',
    message,
    actions: [],
    durationMs: 25,
    telemetry: {
      model: 'stub-model-1',
      tokens: { input_tokens: 40, output_tokens: 12 },
      costUsd: 0.02,
      raw: { type: 'result' },
    },
  }
}

export function failedConversationExecution(
  failure: ConversationExecution['failure'] = 'provider_error',
): ConversationExecution {
  return {
    status: 'failed',
    failure,
    detail: 'fixture conversation response failed',
    durationMs: 10,
  }
}

export interface SeededTask {
  readonly task: Task
  readonly graph: RunGraphRow
}

export async function seedTask(
  db: Database,
  options: { at?: TaskState; status?: TaskState; resume?: TaskState; caps?: Partial<Caps> } = {},
): Promise<SeededTask> {
  const slug = `loop-${crypto.randomUUID().slice(0, 8)}`
  const seeded = await createTask(db, {
    slug,
    title: `Fixture ${slug}`,
    type: 'feature',
    repoUrl: 'file:///dev/null',
    caps: options.caps,
    at: options.at,
  })
  if (options.status) {
    await db
      .update(tasks)
      .set({ status: options.status, resumeStatus: options.resume ?? null })
      .where(eq(tasks.id, seeded.task.id))
    const [task] = await db.select().from(tasks).where(eq(tasks.id, seeded.task.id)).limit(1)
    if (!task) throw new Error('seeded task vanished')

    return { task, graph: seeded.graph }
  }

  return seeded
}

/** Stage runs are detached from tick(); tests wait for the observable effect. */
export async function until(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error('condition not reached in time')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

export async function reload(db: Database, taskId: string): Promise<Task> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1)
  if (!task) throw new Error(`task ${taskId} vanished`)

  return task
}
