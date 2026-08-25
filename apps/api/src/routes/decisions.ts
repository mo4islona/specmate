import { conversations, decisions } from '@specmate/db'
import { and, asc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { OWNER_ACTOR, type RouteContext } from './context.ts'
import { AnswerDecision, DismissDecision } from './schemas.ts'
import { validateJson } from './validation.ts'

/** A question a stage raised, and the two ways it stops being open. */
export function decisionRoutes(ctx: RouteContext) {
  const { db, gates, requireTask, requireDecisionTaskId, performGateAction } = ctx

  return new Hono()
    .get('/tasks/:id/decisions', async (c) => {
      const task = await requireTask(c.req.param('id'))
      const [decisionRows, conversationRows] = await Promise.all([
        db
          .select()
          .from(decisions)
          .where(eq(decisions.taskId, task.id))
          .orderBy(asc(decisions.createdAt), asc(decisions.id)),
        db
          .select({ id: conversations.id, subjectId: conversations.subjectId })
          .from(conversations)
          .where(and(eq(conversations.taskId, task.id), eq(conversations.subjectKind, 'decision'))),
      ])
      const conversationByDecision = new Map(conversationRows.map((row) => [row.subjectId, row.id]))

      return c.json({
        decisions: decisionRows.map((decision) => ({
          ...decision,
          conversationId: conversationByDecision.get(decision.id) ?? null,
        })),
      })
    })

    .post('/decisions/:id/answer', validator('json', validateJson(AnswerDecision)), async (c) => {
      const decisionId = c.req.param('id')
      const taskId = await requireDecisionTaskId(decisionId)
      const input = c.req.valid('json')
      const task = await performGateAction(() =>
        gates.answer({
          taskId,
          decisionId,
          actor: OWNER_ACTOR,
          optionId: input.optionId,
          text: input.text,
        }),
      )

      return c.json({ task })
    })

    .post('/decisions/:id/dismiss', validator('json', validateJson(DismissDecision)), async (c) => {
      const decisionId = c.req.param('id')
      const taskId = await requireDecisionTaskId(decisionId)
      const input = c.req.valid('json')
      const task = await performGateAction(() =>
        gates.dismiss({ taskId, decisionId, actor: OWNER_ACTOR, reason: input.reason }),
      )

      return c.json({ task })
    })
}
