import { events, feedback, stages } from '@specmate/db'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { ApiError } from '../errors.ts'
import { OWNER_ACTOR, type RouteContext } from './context.ts'
import { CreateComment, RestartStage, StopStage } from './schemas.ts'
import { validateJson } from './validation.ts'

/** Stopping a stage, restarting an interrupted one, and the feedback aimed at one. */
export function stageRoutes(ctx: RouteContext) {
  const { db, gates, requireTask, addressedNode, performGateAction } = ctx

  return new Hono()
    .post('/tasks/:id/stages/stop', validator('json', validateJson(StopStage)), async (c) => {
      const task = await requireTask(c.req.param('id'))
      const input = c.req.valid('json')
      const result = await performGateAction(() =>
        gates.stopStage({ taskId: task.id, actor: OWNER_ACTOR, ...input }),
      )

      return c.json(result)
    })

    .post('/tasks/:id/stages/restart', validator('json', validateJson(RestartStage)), async (c) => {
      const task = await requireTask(c.req.param('id'))
      const input = c.req.valid('json')
      const restarted = await performGateAction(() =>
        gates.restartInterruptedStage({ taskId: task.id, actor: OWNER_ACTOR, ...input }),
      )

      return c.json({ task: restarted })
    })

    .post('/tasks/:id/feedback', validator('json', validateJson(CreateComment)), async (c) => {
      const task = await requireTask(c.req.param('id'))
      const input = c.req.valid('json')

      const pinnedStage = input.stageId
        ? (
            await db
              .select()
              .from(stages)
              .where(and(eq(stages.id, input.stageId), eq(stages.taskId, task.id)))
              .limit(1)
          )[0]
        : undefined
      if (input.stageId && !pinnedStage) {
        throw new ApiError('not_found', 'stage was not found for this task', { status: 404 })
      }

      // A comment pinned to a stage is commentary on what that stage did; an
      // unpinned one is addressed to whatever the task's state points at, and
      // that is the only form any agent ever reads (REQ-1008).
      const addressed = pinnedStage ? null : await addressedNode(task)

      const result = await db.transaction(async (tx) => {
        const [comment] = await tx
          .insert(feedback)
          .values({
            taskId: task.id,
            stageId: pinnedStage?.id,
            role: pinnedStage?.role,
            provider: pinnedStage?.provider,
            kind: addressed ? 'intervention' : 'comment',
            textMd: input.comment,
            ...(addressed && {
              target: { graphId: addressed.graphId, nodeKey: addressed.nodeKey },
            }),
          })
          .returning()
        if (!comment) {
          throw new ApiError('internal', 'comment could not be recorded', { status: 500 })
        }

        const [event] = await tx
          .insert(events)
          .values({
            taskId: task.id,
            stageId: pinnedStage?.id,
            type: 'feedback.comment',
            payload: {
              feedbackId: comment.id,
              comment: comment.textMd,
              stageId: pinnedStage?.id ?? null,
              nodeKey: pinnedStage?.nodeKey ?? addressed?.nodeKey ?? null,
              // The thread states where the text went; it can only do that if
              // the event says whether it went anywhere at all.
              guidance: addressed !== null,
            },
          })
          .returning()
        if (!event) {
          throw new ApiError('internal', 'comment event could not be recorded', { status: 500 })
        }

        return { comment, event }
      })

      return c.json({ feedback: result.comment, event: result.event }, 201)
    })
}
