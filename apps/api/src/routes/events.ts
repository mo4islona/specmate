import { events } from '@specmate/db'
import { and, desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { ApiError } from '../errors.ts'
import { eventColumns, type RouteContext } from './context.ts'
import { isRecord } from './serialize.ts'

/**
 * The event log, live or paged. The literal `/tasks/:id/events/stream` is
 * registered ahead of `/tasks/:id/events` because Hono matches in order.
 */
export function eventRoutes(ctx: RouteContext) {
  const { db, requireTask, eventStream } = ctx

  return (
    new Hono()
      .get('/events/stream', (c) => eventStream(c))

      .get('/tasks/:id/events/stream', (c) => eventStream(c, c.req.param('id')))

      .get('/tasks/:id/events', async (c) => {
        const id = c.req.param('id')
        const rows = await db
          .select(eventColumns)
          .from(events)
          .where(eq(events.taskId, id))
          .orderBy(desc(events.seq))
          .limit(200)
        return c.json({ events: rows.reverse() })
      })

      /**
       * REQ-1018: the half of an activity event the timeline does not carry. An
       * event that recorded no edit answers with an absent patch rather than a
       * 404 — the event exists, and "there is nothing to show" is the answer.
       */
      .get('/tasks/:id/events/:seq/patch', async (c) => {
        const task = await requireTask(c.req.param('id'))
        const seq = Number(c.req.param('seq'))
        if (!Number.isSafeInteger(seq) || seq <= 0) {
          throw new ApiError('validation', 'the event cursor must be a positive integer', {
            status: 400,
            fields: { seq: ['must be a positive integer'] },
          })
        }

        const [event] = await db
          .select({ payload: events.payload })
          .from(events)
          .where(and(eq(events.seq, seq), eq(events.taskId, task.id)))
          .limit(1)
        if (!event) throw new ApiError('not_found', `event ${seq} not found`, { status: 404 })

        const edit = event.payload.edit
        const patch = isRecord(edit) && typeof edit.patch === 'string' ? edit.patch : null

        return c.json({ seq, patch })
      })
  )
}
