import { type Database, events, ping, tasks } from '@specmate/db'
import { desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { logger } from 'hono/logger'
import { z } from 'zod'
import { passwordAuth } from './auth.ts'
import type { Config } from './config.ts'

export interface AppDeps {
  db: Database
  config: Config
}

const CreateTask = z.object({
  title: z.string().min(1).max(200),
  type: z.enum(['feature', 'bugfix']),
  repoUrl: z.url(),
  baseBranch: z.string().min(1).default('main'),
})

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

export function createApp({ db, config }: AppDeps) {
  const app = new Hono()

  app.use('*', logger())

  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse()
    console.error(err)
    return c.json({ error: 'internal_error' }, 500)
  })

  // Unauthenticated probes — no task data, safe for container healthchecks.
  app.get('/healthz', (c) => c.json({ ok: true }))
  app.get('/readyz', async (c) => {
    try {
      await ping(db)
      return c.json({ ok: true, db: 'up' })
    } catch (e) {
      return c.json({ ok: false, db: 'down', detail: (e as Error).message }, 503)
    }
  })

  const api = new Hono().use('*', passwordAuth(config.SPECMATE_PASSWORD))

  api.get('/version', (c) =>
    c.json({
      name: 'specmate',
      phase: 0,
      env: config.NODE_ENV,
      revision: process.env.GIT_SHA ?? null,
    }),
  )

  api.get('/tasks', async (c) => {
    const rows = await db.select().from(tasks).orderBy(desc(tasks.createdAt)).limit(100)
    return c.json({ tasks: rows })
  })

  api.post('/tasks', async (c) => {
    const parsed = CreateTask.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      return c.json({ error: 'invalid_body', detail: z.prettifyError(parsed.error) }, 400)
    }
    const { title, type, repoUrl, baseBranch } = parsed.data
    const [task] = await db
      .insert(tasks)
      .values({
        slug: `${slugify(title)}-${Bun.randomUUIDv7().slice(0, 8)}`,
        title,
        type,
        repoUrl,
        baseBranch,
      })
      .returning()
    if (!task) throw new HTTPException(500, { message: 'task insert returned no row' })
    await db.insert(events).values({ taskId: task.id, type: 'task.created', payload: { title } })
    return c.json({ task }, 201)
  })

  api.get('/tasks/:id/events', async (c) => {
    const id = c.req.param('id')
    const rows = await db
      .select()
      .from(events)
      .where(eq(events.taskId, id))
      .orderBy(desc(events.seq))
      .limit(200)
    return c.json({ events: rows.reverse() })
  })

  app.route('/api/v1', api)

  return app
}
