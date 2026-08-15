import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import type { ExecutionEnvironment } from '@specmate/core'
import { createDb, type Database, events, tasks } from '@specmate/db'
import { asc, eq, inArray } from 'drizzle-orm'
import {
  ENVIRONMENT_PINNED_EVENT,
  ENVIRONMENT_REPINNED_EVENT,
  WorkspaceService,
} from '../src/service.ts'
import { cleanupTempDirs, makeManager, makeOrigin, resolveTestEnvironment } from './fixtures.ts'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

describeDb('workspace execution environment', () => {
  let db: Database
  const createdTaskIds: string[] = []

  beforeAll(() => {
    db = createDb(url)
  })

  afterAll(async () => {
    if (createdTaskIds.length > 0) {
      await db.delete(tasks).where(inArray(tasks.id, createdTaskIds))
    }
    await cleanupTempDirs()
  })

  test('pins once at provision and records an explicit re-pin', async () => {
    const origin = await makeOrigin({ '.nvmrc': '22.14.0\n' })
    const { manager } = await makeManager()
    const slug = `environment-${randomUUID().slice(0, 8)}`
    const [task] = await db
      .insert(tasks)
      .values({
        slug,
        title: 'environment fixture',
        type: 'feature',
        repoUrl: origin.url,
        baseBranch: 'main',
      })
      .returning()
    if (!task) throw new Error('task insert returned no row')
    createdTaskIds.push(task.id)

    const service = new WorkspaceService(manager, db, resolveTestEnvironment)
    const request = {
      taskId: task.id,
      slug,
      repoUrl: origin.url,
      baseBranch: 'main',
      image: 'specmate/runner-universal@sha256:first',
    }
    const workspace = await service.provision(request)

    expect(await environmentOf(task.id)).toEqual({
      image: request.image,
      toolchains: [{ name: 'node', version: '22.14.0' }],
    })
    expect(await eventsFor(task.id)).toEqual([
      expect.objectContaining({ type: ENVIRONMENT_PINNED_EVENT }),
    ])

    await service.provision({
      ...request,
      image: 'specmate/runner-universal@sha256:ignored-default',
    })

    expect((await environmentOf(task.id))?.image).toBe(request.image)
    expect(await eventsFor(task.id)).toHaveLength(1)

    const repinned = await service.repinEnvironment(
      task.id,
      workspace,
      'specmate/runner-universal@sha256:second',
    )

    expect(await environmentOf(task.id)).toEqual(repinned)
    const recorded = await eventsFor(task.id)
    expect(recorded.map((event) => event.type)).toEqual([
      ENVIRONMENT_PINNED_EVENT,
      ENVIRONMENT_REPINNED_EVENT,
    ])
    expect(recorded[1]?.payload).toMatchObject({
      previous: { image: request.image },
      environment: { image: repinned.image },
    })
  })

  async function environmentOf(taskId: string): Promise<ExecutionEnvironment | null> {
    const [task] = await db
      .select({ environment: tasks.environment })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1)

    return task?.environment ?? null
  }

  function eventsFor(taskId: string) {
    return db.select().from(events).where(eq(events.taskId, taskId)).orderBy(asc(events.seq))
  }
})
