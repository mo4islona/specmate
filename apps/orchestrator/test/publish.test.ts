import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { createDb, type Database, events, pullRequests, tasks } from '@specmate/db'
import {
  Git,
  type GitSpawn,
  resolveWorkspaceConfig,
  type SpawnSpec,
  type WorkspaceConfig,
} from '@specmate/workspace'
import { asc, eq, inArray } from 'drizzle-orm'
import { Publisher } from '../src/publish.ts'
import { seedTask } from './fixtures.ts'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

function gitStub(options: { failPush?: boolean } = {}): {
  git: Git
  calls: SpawnSpec[]
  config: WorkspaceConfig
} {
  const calls: SpawnSpec[] = []
  const stream = (text: string) => new Response(text).body as ReadableStream<Uint8Array>
  const spawn: GitSpawn = (spec) => {
    calls.push(spec)
    const isPush = spec.cmd.includes('push')
    return {
      stdout: stream(spec.cmd.includes('show') ? '# Summary\n' : ''),
      stderr: stream(options.failPush && isPush ? 'rejected' : ''),
      exited: Promise.resolve(options.failPush && isPush ? 1 : 0),
    }
  }
  const config = resolveWorkspaceConfig({
    root: '/tmp/publish-test',
    githubToken: async () => 'token',
  })
  const git = new Git(config, spawn)

  return { git, calls, config }
}

describeDb('publish action', () => {
  let db: Database
  const created: string[] = []

  beforeAll(() => {
    db = createDb(url)
  })

  afterEach(async () => {
    if (created.length > 0) await db.delete(tasks).where(inArray(tasks.id, created.splice(0)))
  })

  async function publish(
    options: {
      failPush?: boolean
      response?: Response
      existing?: boolean
      fetch?: typeof fetch
    } = {},
  ) {
    const { task, graph } = await seedTask(db, {
      status: 'publish',
      repoUrl: 'git@github.com:owner/repo.git',
    })
    created.push(task.id)
    if (options.existing) {
      await db.insert(pullRequests).values({
        taskId: task.id,
        url: `https://github.com/owner/repo/pull/${crypto.randomUUID()}`,
        state: 'open',
      })
    }
    const { git, calls, config } = gitStub({ failPush: options.failPush })
    const publisher = new Publisher({
      db,
      git,
      workspaceConfig: config,
      token: async () => 'token',
      fetch:
        options.fetch ??
        ((async () =>
          options.response ??
          Response.json({
            html_url: 'https://github.com/owner/repo/pull/1',
          })) as unknown as typeof fetch),
    })
    const node = graph.dag.nodes.find((candidate) => candidate.key === 'publish')
    if (node?.kind !== 'action') throw new Error('fixture graph has no publish action')
    await publisher.run(task, graph.dag, node).catch(() => undefined)

    return { task, calls }
  }

  test('pushes, creates one pull request, and archives the task', async () => {
    const { task, calls } = await publish()
    expect(calls.some((call) => call.cmd.includes('push'))).toBe(true)
    const [stored] = await db.select().from(tasks).where(eq(tasks.id, task.id))
    expect(stored?.status).toBe('archived')
    const rows = await db.select().from(pullRequests).where(eq(pullRequests.taskId, task.id))
    expect(rows).toHaveLength(1)
  })

  test('advances without publishing again when a row already exists', async () => {
    const { task, calls } = await publish({ existing: true })
    expect(calls).toHaveLength(0)
    const rows = await db.select().from(pullRequests).where(eq(pullRequests.taskId, task.id))
    expect(rows).toHaveLength(1)
    const [stored] = await db.select().from(tasks).where(eq(tasks.id, task.id))
    expect(stored?.status).toBe('archived')
  })

  test('fails the task when the push is rejected', async () => {
    const { task } = await publish({ failPush: true })
    const [stored] = await db.select().from(tasks).where(eq(tasks.id, task.id))
    expect(stored?.status).toBe('failed')
  })

  test('recovers a pull request GitHub already opened on a retry after a crash', async () => {
    const fetchStub = (async (_input, init) => {
      if (init?.method === 'POST') {
        return Response.json({ message: 'A pull request already exists.' }, { status: 422 })
      }

      return Response.json([{ html_url: 'https://github.com/owner/repo/pull/7' }])
    }) as typeof fetch
    const { task } = await publish({ fetch: fetchStub })

    const [stored] = await db.select().from(tasks).where(eq(tasks.id, task.id))
    expect(stored?.status).toBe('archived')
    const rows = await db.select().from(pullRequests).where(eq(pullRequests.taskId, task.id))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.url).toBe('https://github.com/owner/repo/pull/7')
  })

  test('fails the task when pull request creation is rejected', async () => {
    const { task } = await publish({
      response: Response.json({ message: 'forbidden' }, { status: 403 }),
    })
    const [stored] = await db.select().from(tasks).where(eq(tasks.id, task.id))
    expect(stored?.status).toBe('failed')
    const rows = await db
      .select()
      .from(events)
      .where(eq(events.taskId, task.id))
      .orderBy(asc(events.seq))
    expect(rows.at(-1)?.payload).toMatchObject({ reason: expect.stringContaining('forbidden') })
  })
})
