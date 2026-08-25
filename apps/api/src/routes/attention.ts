import { isHumanGate, isTerminal } from '@specmate/core'
import { decisions, events, type Task, tasks } from '@specmate/db'
import { and, desc, eq, inArray, ne } from 'drizzle-orm'
import { Hono } from 'hono'
import type { RouteContext } from './context.ts'

interface AttentionItem {
  /** Stable per-row identity: a task carries at most one gate/failed/stalled
   * item but may carry several open decisions, so only the decision item
   * can key off the decision itself. */
  id: string
  task: Pick<Task, 'id' | 'slug' | 'title' | 'type' | 'status'>
  reason: {
    kind: 'gate' | 'decision' | 'failed' | 'stalled'
    detail: string
  }
  since: Date
}

/** Everything waiting on the owner, across every task, in one read. */
export function attentionRoutes(ctx: RouteContext) {
  const { db, config, now } = ctx

  return new Hono().get('/attention', async (c) => {
    const taskRows = await db.select().from(tasks)
    if (taskRows.length === 0) {
      return c.json({ items: [] })
    }

    const taskIds = taskRows.map((task) => task.id)
    // `stage.activity` fires on every recognized tool use — many times a
    // minute during a busy stage — so it must not count as the "latest
    // event" the stall check resets on, or a stage stuck in a loop keeps
    // itself looking alive forever.
    const latestEventRows = await db
      .selectDistinctOn([events.taskId])
      .from(events)
      .where(and(inArray(events.taskId, taskIds), ne(events.type, 'stage.activity')))
      .orderBy(events.taskId, desc(events.seq))
    const failureRows = await db
      .selectDistinctOn([events.taskId])
      .from(events)
      .where(and(inArray(events.taskId, taskIds), eq(events.type, 'task.failed')))
      .orderBy(events.taskId, desc(events.seq))
    const latestEvents = new Map(
      latestEventRows.flatMap((event) => (event.taskId ? [[event.taskId, event] as const] : [])),
    )
    const failures = new Map(
      failureRows.flatMap((event) => (event.taskId ? [[event.taskId, event] as const] : [])),
    )

    const openDecisionRows = await db
      .select({ decision: decisions, task: tasks })
      .from(decisions)
      .innerJoin(tasks, eq(decisions.taskId, tasks.id))
      .where(eq(decisions.status, 'open'))

    const tasksWithOpenDecision = new Set(openDecisionRows.map(({ task }) => task.id))
    const stallCutoff = new Date(now().getTime() - config.SPECMATE_STALL_HOURS * 60 * 60 * 1_000)
    const items: AttentionItem[] = []

    // A decision is its own attention source: it names its own question and
    // the moment it was raised, whether or not it also parked the task.
    for (const { decision, task } of openDecisionRows) {
      items.push({
        id: decision.id,
        task: {
          id: task.id,
          slug: task.slug,
          title: task.title,
          type: task.type,
          status: task.status,
        },
        reason: { kind: 'decision', detail: decision.promptMd },
        since: decision.createdAt,
      })
    }

    for (const task of taskRows) {
      const latest = latestEvents.get(task.id)
      const taskSummary = {
        id: task.id,
        slug: task.slug,
        title: task.title,
        type: task.type,
        status: task.status,
      }

      // waiting_human carries no gate item of its own: REQ-1201 guarantees
      // it has at least one open decision, already covered above. If that
      // invariant is ever violated, fail open here rather than let the
      // task silently vanish from the list — see reportUnexplainedParks.
      if (isHumanGate(task.status)) {
        items.push({
          id: task.id,
          task: taskSummary,
          reason: { kind: 'gate', detail: `waiting at ${task.status}` },
          since: task.updatedAt,
        })
        continue
      }
      if (task.status === 'waiting_human') {
        if (!tasksWithOpenDecision.has(task.id)) {
          items.push({
            id: task.id,
            task: taskSummary,
            reason: { kind: 'gate', detail: 'waiting_human with no open decision on record' },
            since: task.updatedAt,
          })
        }
        continue
      }

      if (task.status === 'failed') {
        const failure = failures.get(task.id)
        const failureReason = failure?.payload.reason
        items.push({
          id: task.id,
          task: taskSummary,
          reason: {
            kind: 'failed',
            detail: typeof failureReason === 'string' ? failureReason : 'task failed',
          },
          since: failure?.createdAt ?? task.updatedAt,
        })
        continue
      }

      const since = latest?.createdAt ?? task.updatedAt
      if (!isTerminal(task.status) && since < stallCutoff) {
        items.push({
          id: task.id,
          task: taskSummary,
          reason: {
            kind: 'stalled',
            detail: `no activity for at least ${config.SPECMATE_STALL_HOURS} hours`,
          },
          since,
        })
      }
    }
    items.sort((left, right) => left.since.getTime() - right.since.getTime())

    return c.json({ items })
  })
}
