import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import assert from 'node:assert/strict'
import { createDb, type Database, events, tasks } from '@specmate/db'
import { Engine } from '@specmate/orchestrator/engine'
import { mirrorKey } from '@specmate/workspace'
import { count, inArray } from 'drizzle-orm'
import { createApp, type ReferenceReads, type WorkspaceDiffOperations } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

const workspaceStub: WorkspaceDiffOperations = {
  diffFiles: () => Promise.reject(new Error('these tests do not read task diffs')),
  diffFile: () => Promise.reject(new Error('these tests do not read task diffs')),
}

/** Never reaches GitHub: the read's degradation is the package's own test. */
const referenceStub: ReferenceReads = {
  read: async (reference) =>
    reference.number === 404
      ? { read: false, reason: 'not_found', detail: 'not found' }
      : {
          read: true,
          detail: {
            kind: 'issue',
            owner: reference.owner,
            repo: reference.repo,
            number: reference.number,
            title: 'Login redirect lands on the homepage',
            state: 'open',
            labels: ['bug'],
            author: 'dana',
            url: reference.url,
          },
        },
}

describeDb('intake preview', () => {
  assert(url)
  const db: Database = createDb(url)
  const auth = { authorization: 'Bearer test-password', 'content-type': 'application/json' }
  const createdTaskIds: string[] = []
  // Unique per run: `knownRepositories` groups over every task in the database,
  // so a fixed name would make this suite depend on what else has run.
  const run = crypto.randomUUID().slice(0, 8)
  const ALPHA = `https://github.com/example/alpha-${run}`
  const BETA = `https://github.com/example/beta-${run}`

  let app: ReturnType<typeof createApp>

  beforeAll(async () => {
    app = createApp({
      db,
      gates: new Engine({
        db,
        workspaces: {
          provision: () => Promise.reject(new Error('no provisioning here')),
          provisionConversation: () => Promise.reject(new Error('no provisioning here')),
          releaseConversation: () => Promise.resolve(),
          discard: () => Promise.reject(new Error('no discarding here')),
          release: () => Promise.resolve(),
        },
        settings: { stageConcurrency: 1, stageAttemptCap: 1, availableProviders: ['claude-code'] },
      }),
      workspace: workspaceStub,
      references: referenceStub,
      config: loadConfig({
        DATABASE_URL: url,
        NODE_ENV: 'test',
        SPECMATE_PASSWORD: 'test-password',
        WORKSPACE_ROOT: 'workspaces',
      }),
    })

    for (const [index, repoUrl] of [ALPHA, BETA].entries()) {
      const [task] = await db
        .insert(tasks)
        .values({
          slug: `preview-${run}-${index}`,
          title: `fixture for ${repoUrl}`,
          type: 'feature',
          repoUrl,
          baseBranch: 'trunk',
          status: 'specify',
        })
        .returning()
      assert(task)
      createdTaskIds.push(task.id)
    }
  })

  afterAll(async () => {
    try {
      if (createdTaskIds.length > 0) {
        await db.delete(tasks).where(inArray(tasks.id, createdTaskIds))
      }
    } finally {
      await db.$client.close()
    }
  })

  async function preview(body: Record<string, unknown>) {
    const response = await app.request('/api/v1/intake/preview', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify(body),
    })

    return { status: response.status, body: (await response.json()) as Record<string, never> }
  }

  it('names the repository a request resolves to, and the rule that resolved it — AC-1062', async () => {
    const { status, body } = await preview({ description: `fix the redirect in ${ALPHA}` })

    expect(status).toBe(200)
    expect(body.repository).toMatchObject({
      resolved: true,
      repoUrl: ALPHA,
      id: mirrorKey(ALPHA),
      via: 'request-url',
      known: true,
    })
  })

  it('reports a repository nothing has run against as unknown', async () => {
    const { body } = await preview({ description: 'work on https://github.com/example/unseen' })

    expect(body.repository).toMatchObject({ resolved: true, known: false })
  })

  it('carries the candidates when more than one known repository matches — AC-1063', async () => {
    const { body } = await preview({
      description: `move alpha-${run} onto the beta-${run} pipeline`,
    })

    expect(body.repository).toMatchObject({ resolved: false, repoUrl: null, via: null })
    expect(
      (body.repository as unknown as { candidates: { repoUrl: string }[] }).candidates.map(
        (candidate) => candidate.repoUrl,
      ),
    ).toEqual(expect.arrayContaining([ALPHA, BETA]))
  })

  it('takes a chosen repository over anything the text says', async () => {
    const { body } = await preview({ description: `fix the redirect in ${ALPHA}`, repoUrl: BETA })

    expect(body.repository).toMatchObject({ repoUrl: BETA, via: 'chosen' })
  })

  it('answers an empty request rather than rejecting it', async () => {
    expect((await preview({ description: '' })).status).toBe(200)
  })

  it('carries the references the text names, unfetched', async () => {
    const { body } = await preview({
      description: `see https://github.com/example/alpha-${run}/issues/412 and acme/other#7`,
    })

    expect(body.references).toMatchObject([
      { number: 412, kind: 'issue', explicit: true },
      { owner: 'acme', repo: 'other', number: 7, explicit: false },
    ])
  })

  it('creates no task and no event, however often it is called — AC-1064', async () => {
    const before = await Promise.all([
      db.select({ n: count() }).from(tasks),
      db.select({ n: count() }).from(events),
    ])

    for (const description of ['', `fix ${ALPHA}`, 'nothing in particular', `and ${BETA}`]) {
      await preview({ description })
    }

    const after = await Promise.all([
      db.select({ n: count() }).from(tasks),
      db.select({ n: count() }).from(events),
    ])
    expect(after[0][0]?.n).toBe(before[0][0]?.n as number)
    expect(after[1][0]?.n).toBe(before[1][0]?.n as number)
  })

  it('names the repository the launch then creates the task against — AC-1065', async () => {
    const description = `fix the login redirect in ${ALPHA}`
    const { body } = await preview({ description })

    const launched = await app.request('/api/v1/tasks', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ description }),
    })
    expect(launched.status).toBe(201)
    const { task } = (await launched.json()) as { task: { id: string; repoUrl: string } }
    createdTaskIds.push(task.id)

    expect(task.repoUrl).toBe((body.repository as unknown as { repoUrl: string }).repoUrl)
  })
})

describeDb('one repository, and what the system holds about it', () => {
  assert(url)
  const db: Database = createDb(url)
  const auth = { authorization: 'Bearer test-password' }
  const run = crypto.randomUUID().slice(0, 8)
  const REPO = `https://github.com/example/holdings-${run}`
  const createdTaskIds: string[] = []

  let app: ReturnType<typeof createApp>

  beforeAll(async () => {
    app = createApp({
      db,
      gates: new Engine({
        db,
        workspaces: {
          provision: () => Promise.reject(new Error('no provisioning here')),
          provisionConversation: () => Promise.reject(new Error('no provisioning here')),
          releaseConversation: () => Promise.resolve(),
          discard: () => Promise.reject(new Error('no discarding here')),
          release: () => Promise.resolve(),
        },
        settings: { stageConcurrency: 1, stageAttemptCap: 1, availableProviders: ['claude-code'] },
      }),
      workspace: workspaceStub,
      references: referenceStub,
      config: loadConfig({
        DATABASE_URL: url,
        NODE_ENV: 'test',
        SPECMATE_PASSWORD: 'test-password',
        WORKSPACE_ROOT: 'workspaces',
      }),
    })

    const [task] = await db
      .insert(tasks)
      .values({
        slug: `holdings-${run}`,
        title: 'a task that already ran here',
        type: 'feature',
        repoUrl: REPO,
        baseBranch: 'trunk',
        status: 'archived',
      })
      .returning()
    assert(task)
    createdTaskIds.push(task.id)
  })

  afterAll(async () => {
    try {
      await db.delete(tasks).where(inArray(tasks.id, createdTaskIds))
    } finally {
      await db.$client.close()
    }
  })

  it('carries the counts, the tasks that ran, and an empty memory excerpt — AC-1066, AC-1067', async () => {
    const response = await app.request(`/api/v1/repositories/${mirrorKey(REPO)}`, {
      headers: auth,
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      repository: { repoUrl: REPO, taskCount: 1, isDefault: false, baseBranch: 'trunk' },
      // Nothing set by hand, and no task has resolved one against a real tree.
      specConvention: { setting: null, resolved: null },
      coverageWaiver: null,
      recentTasks: [{ title: 'a task that already ran here', status: 'archived' }],
      // A store no stage has written is a repository nothing has been learned
      // about, not a failure to read one.
      memory: { total: 0, entries: [] },
    })
  })

  it('refuses an identity no repository has — AC-1068', async () => {
    const response = await app.request('/api/v1/repositories/deadbeefdeadbeef', { headers: auth })

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: 'not_found' })
  })

  it('carries the convention a real checkout resolved on the last task', async () => {
    const withConvention = `https://github.com/example/resolved-${run}`
    const [task] = await db
      .insert(tasks)
      .values({
        slug: `resolved-${run}`,
        title: 'a task that resolved its convention',
        type: 'feature',
        repoUrl: withConvention,
        status: 'archived',
        specConvention: {
          profile: 'openspec',
          suitePath: 'openspec/specs',
          conventionNote: null,
          missingSuitePath: null,
        },
      })
      .returning()
    assert(task)
    createdTaskIds.push(task.id)

    const response = await app.request(`/api/v1/repositories/${mirrorKey(withConvention)}`, {
      headers: auth,
    })

    expect(await response.json()).toMatchObject({
      specConvention: { resolved: { profile: 'openspec', suitePath: 'openspec/specs' } },
    })
  })
})

describeDb('probing a repository with no history here', () => {
  assert(url)
  const db: Database = createDb(url)
  const auth = { authorization: 'Bearer test-password' }

  let app: ReturnType<typeof createApp>
  let asked: unknown[] = []

  beforeAll(() => {
    asked = []
    app = createApp({
      db,
      gates: new Engine({
        db,
        workspaces: {
          provision: () => Promise.reject(new Error('no provisioning here')),
          provisionConversation: () => Promise.reject(new Error('no provisioning here')),
          releaseConversation: () => Promise.resolve(),
          discard: () => Promise.reject(new Error('no discarding here')),
          release: () => Promise.resolve(),
        },
        settings: { stageConcurrency: 1, stageAttemptCap: 1, availableProviders: ['claude-code'] },
      }),
      workspace: workspaceStub,
      references: referenceStub,
      repositoryProbes: {
        probe: async (target) => {
          asked.push(target)

          return target.repo === 'unreadable'
            ? { read: false, reason: 'no_credential', detail: 'nothing stored' }
            : {
                read: true,
                detail: {
                  owner: target.owner,
                  repo: target.repo,
                  defaultBranch: 'trunk',
                  isPrivate: false,
                  description: null,
                  presentPaths: target.repo === 'specced' ? [...target.paths] : [],
                },
              }
        },
      },
      config: loadConfig({
        DATABASE_URL: url,
        NODE_ENV: 'test',
        SPECMATE_PASSWORD: 'test-password',
        WORKSPACE_ROOT: 'workspaces',
      }),
    })
  })

  afterAll(() => db.$client.close())

  function probe(repoUrl: string) {
    return app.request(`/api/v1/repositories/probe?repoUrl=${encodeURIComponent(repoUrl)}`, {
      headers: auth,
    })
  }

  it('resolves the convention from what the tree turned out to hold', async () => {
    const response = await probe('https://github.com/example/specced')

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      probe: { read: true, defaultBranch: 'trunk' },
      specConvention: { profile: 'openspec', suitePath: 'openspec/specs' },
    })
    expect(asked).toMatchObject([{ owner: 'example', repo: 'specced', paths: ['openspec/specs'] }])
  })

  it('resolves to no suite when the tree does not hold one', async () => {
    const response = await probe('https://github.com/example/plain')

    expect(await response.json()).toMatchObject({
      specConvention: { profile: 'none', suitePath: null },
    })
  })

  it('reports an unreadable tree without claiming the repository has no suite', async () => {
    const response = await probe('https://github.com/example/unreadable')

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      probe: { read: false, reason: 'no_credential' },
      specConvention: null,
    })
  })

  it('does not reach out for a host it cannot read', async () => {
    const before = asked.length
    const response = await probe('https://gitlab.com/example/widgets')

    expect(await response.json()).toMatchObject({
      probe: { read: false, reason: 'unsupported_host' },
    })
    expect(asked.length).toBe(before)
  })

  it('rejects a value that is not a repository URL', async () => {
    expect((await probe('not-a-url')).status).toBe(400)
  })
})

describeDb('reading a reference', () => {
  assert(url)
  const db: Database = createDb(url)
  const auth = { authorization: 'Bearer test-password' }

  let app: ReturnType<typeof createApp>

  beforeAll(() => {
    app = createApp({
      db,
      gates: new Engine({
        db,
        workspaces: {
          provision: () => Promise.reject(new Error('no provisioning here')),
          provisionConversation: () => Promise.reject(new Error('no provisioning here')),
          releaseConversation: () => Promise.resolve(),
          discard: () => Promise.reject(new Error('no discarding here')),
          release: () => Promise.resolve(),
        },
        settings: { stageConcurrency: 1, stageAttemptCap: 1, availableProviders: ['claude-code'] },
      }),
      workspace: workspaceStub,
      references: referenceStub,
      config: loadConfig({
        DATABASE_URL: url,
        NODE_ENV: 'test',
        SPECMATE_PASSWORD: 'test-password',
        WORKSPACE_ROOT: 'workspaces',
      }),
    })
  })

  afterAll(() => db.$client.close())

  function read(query: Record<string, string | number>) {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) search.set(key, String(value))

    return app.request(`/api/v1/references?${search}`, { headers: auth })
  }

  it('carries what the reference points at — AC-1069', async () => {
    const response = await read({ host: 'github.com', owner: 'acme', repo: 'widgets', number: 412 })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      result: { read: true, detail: { number: 412, title: expect.any(String), state: 'open' } },
    })
  })

  it('reports an unreadable reference as a result, not as an error — AC-1070, AC-1071', async () => {
    const response = await read({ host: 'github.com', owner: 'acme', repo: 'widgets', number: 404 })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ result: { read: false, reason: 'not_found' } })
  })

  it('rejects a reference that is not addressable by its parts', async () => {
    expect((await read({ host: 'github.com', owner: 'acme', repo: 'widgets' })).status).toBe(400)
  })
})
