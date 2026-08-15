import { beforeAll, describe, expect, test } from 'bun:test'
import { createDb, type Database } from '@specmate/db'
import { createApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

describeDb('api', () => {
  let app: ReturnType<typeof createApp>
  let db: Database

  beforeAll(() => {
    db = createDb(url)
    app = createApp({
      db,
      config: loadConfig({
        DATABASE_URL: url,
        NODE_ENV: 'test',
        SPECMATE_PASSWORD: 'test-password',
      }),
    })
  })

  test('healthz needs no credentials', async () => {
    const res = await app.request('/healthz')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  test('readyz reports the database', async () => {
    const res = await app.request('/readyz')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, db: 'up' })
  })

  test('api routes reject a missing or wrong password', async () => {
    expect((await app.request('/api/v1/tasks')).status).toBe(401)
    const wrong = await app.request('/api/v1/tasks', {
      headers: { authorization: 'Bearer nope' },
    })
    expect(wrong.status).toBe(401)
  })

  test('creates and lists a task', async () => {
    const auth = { authorization: 'Bearer test-password', 'content-type': 'application/json' }
    const created = await app.request('/api/v1/tasks', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        title: 'Verify the walking skeleton',
        type: 'bugfix',
        repoUrl: 'https://github.com/example/repo',
      }),
    })
    expect(created.status).toBe(201)
    const { task } = (await created.json()) as { task: { id: string; status: string } }
    expect(task.status).toBe('draft')

    const listed = await app.request('/api/v1/tasks', { headers: auth })
    const { tasks } = (await listed.json()) as { tasks: { id: string }[] }
    expect(tasks.some((t) => t.id === task.id)).toBe(true)

    const events = await app.request(`/api/v1/tasks/${task.id}/events`, { headers: auth })
    const body = (await events.json()) as { events: { type: string }[] }
    expect(body.events.map((e) => e.type)).toContain('task.created')
  })

  test('rejects an invalid body', async () => {
    const res = await app.request('/api/v1/tasks', {
      method: 'POST',
      headers: { authorization: 'Bearer test-password', 'content-type': 'application/json' },
      body: JSON.stringify({ title: '', type: 'chore', repoUrl: 'not-a-url' }),
    })
    expect(res.status).toBe(400)
  })
})
