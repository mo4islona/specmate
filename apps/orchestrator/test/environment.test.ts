import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import {
  type ExecutionEnvironment,
  FEATURE_BUGFIX_PIPELINE,
  instantiateDefinition,
  type StageNode,
} from '@specmate/core'
import { createDb, type Database, events, type Task, tasks } from '@specmate/db'
import type { StageExecution, StageExecutor, StageRequest } from '@specmate/runner'
import type { Workspace } from '@specmate/workspace'
import { mirrorKey, WorkspaceManager, WorkspaceService } from '@specmate/workspace'
import { and, eq, inArray } from 'drizzle-orm'
import { createStageDispatcher } from '../src/dispatch.ts'
import type { StageDispatch } from '../src/engine.ts'
import { createStageEnvironment } from '../src/environment.ts'
import { reload, seedTask } from './fixtures.ts'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

const DAG = instantiateDefinition(FEATURE_BUGFIX_PIPELINE)

/** What the task was pinned to when it was provisioned, and what the host now runs. */
const PINNED: ExecutionEnvironment = {
  image: 'specmate/runner-universal@sha256:85ebb7e8',
  toolchains: [{ name: 'bun', version: '1.3.9' }],
}
const REBUILT: ExecutionEnvironment = {
  image: 'specmate/runner-universal@sha256:c0ffee11',
  toolchains: [{ name: 'bun', version: '1.3.9' }],
}
const CONFIGURED_IMAGE = 'specmate/runner-universal:latest'

function specifyNode(): StageNode {
  const node = DAG.nodes.find((candidate) => candidate.key === 'specify')
  if (node?.kind !== 'stage') throw new Error('the pipeline no longer specifies')

  return node
}

/** Records the request rather than running anything; what it was given is the subject. */
function recordingExecutor() {
  const requests: StageRequest[] = []
  const executor = {
    execute: async (request: StageRequest) => {
      requests.push(request)

      return { status: 'succeeded', attempts: [] } as unknown as StageExecution
    },
  } as unknown as StageExecutor

  return { executor, requests }
}

describeDb('the pin a stage runs on', () => {
  let db: Database
  const created: string[] = []

  beforeAll(() => {
    db = createDb(url)
  })

  afterAll(async () => {
    if (created.length > 0) await db.delete(tasks).where(inArray(tasks.id, created.splice(0)))
    await db.$client.close()
  })

  async function seedPinnedTask() {
    const { task } = await seedTask(db, { at: 'specify' })
    created.push(task.id)
    await db.update(tasks).set({ environment: PINNED }).where(eq(tasks.id, task.id))

    const workspace: Workspace = {
      slug: task.slug,
      repoUrl: task.repoUrl,
      mirrorKey: mirrorKey(task.repoUrl),
      branch: `specmate/${task.slug}`,
      baseBranch: 'main',
      path: `/workspaces/tasks/${task.slug}`,
      changeDir: `openspec/changes/${task.slug}`,
      mirrorPath: '/workspaces/mirrors/repo.git',
    }

    return { task, workspace }
  }

  /**
   * The real service, so the substitution is recorded where a reader would look
   * for it. Only its resolver is a stand-in — resolving an image is the
   * backend's job and takes a container runtime.
   */
  function serviceResolving(resolve: () => Promise<ExecutionEnvironment>) {
    return new WorkspaceService(new WorkspaceManager({ config: { root: '/tmp/unused' } }), db, () =>
      resolve(),
    )
  }

  function dispatcherOver(options: {
    resolves: boolean
    resolve: () => Promise<ExecutionEnvironment>
  }) {
    const { executor, requests } = recordingExecutor()
    const service = serviceResolving(options.resolve)
    const stageEnvironment = createStageEnvironment({
      pinned: async (taskId) => (await reload(db, taskId)).environment as ExecutionEnvironment,
      resolvesImage: async () => options.resolves,
      repin: (taskId, workspace) => service.repinEnvironment(taskId, workspace, CONFIGURED_IMAGE),
    })

    return { dispatcher: createStageDispatcher({ executor, stageEnvironment }), requests }
  }

  function dispatchOf(task: Task, workspace: Workspace): StageDispatch {
    return {
      task,
      graphId: '5fec2806-63af-43a9-b55a-291fe7f53207',
      dag: DAG,
      node: specifyNode(),
      stageId: '9a7c2d87-e27f-4ab3-9ed7-d331619ee29d',
      attempt: 1,
      provider: 'claude-code',
      workspace,
      resume: null,
      signal: new AbortController().signal,
    }
  }

  async function repinEvents(taskId: string) {
    return db
      .select()
      .from(events)
      .where(and(eq(events.taskId, taskId), eq(events.type, 'task.environment_repinned')))
  }

  it('AC-816: re-pins to what the deployment runs, and records the substitution', async () => {
    const { task, workspace } = await seedPinnedTask()
    const { dispatcher, requests } = dispatcherOver({
      resolves: false,
      resolve: async () => REBUILT,
    })

    await dispatcher(dispatchOf(task, workspace))

    expect(requests[0]?.environment).toEqual(REBUILT)
    expect((await reload(db, task.id)).environment).toEqual(REBUILT)
    expect(await repinEvents(task.id)).toHaveLength(1)
  })

  it('AC-817: leaves a pin that resolves alone, whatever the default has become', async () => {
    const { task, workspace } = await seedPinnedTask()
    const { dispatcher, requests } = dispatcherOver({
      resolves: true,
      // Reached only by a re-pin, which is the thing this test says does not happen.
      resolve: async () => REBUILT,
    })

    await dispatcher(dispatchOf(task, workspace))

    expect(requests[0]?.environment).toEqual(PINNED)
    expect((await reload(db, task.id)).environment).toEqual(PINNED)
    expect(await repinEvents(task.id)).toHaveLength(0)
  })

  it('AC-818: fails the stage naming the image when there is nothing to re-pin to', async () => {
    const { task, workspace } = await seedPinnedTask()
    const { dispatcher, requests } = dispatcherOver({
      resolves: false,
      resolve: async () => {
        throw new Error('could not pin runner image: the container runtime is unreachable')
      },
    })

    const execution = await dispatcher(dispatchOf(task, workspace))

    expect(execution.status).toBe('failed')
    expect(execution.failure).toBe('backend_error')
    expect(execution.detail).toContain(PINNED.image)
    expect(requests).toHaveLength(0)
    expect((await reload(db, task.id)).environment).toEqual(PINNED)
    expect(await repinEvents(task.id)).toHaveLength(0)
  })
})
