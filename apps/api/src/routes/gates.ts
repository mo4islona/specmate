import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { OWNER_ACTOR, type RouteContext } from './context.ts'
import { GateComment, ReworkGate } from './schemas.ts'
import { validateJson } from './validation.ts'

/** The three answers to a human gate: approve, redirect, send back for rework. */
export function gateRoutes(ctx: RouteContext) {
  const { gates, requireTask, performGateAction } = ctx

  return new Hono()
    .post('/tasks/:id/gates/approve', async (c) => {
      const task = await requireTask(c.req.param('id'))
      await performGateAction(() => gates.approve(task.id, OWNER_ACTOR))

      return c.json({ task: await requireTask(task.id) })
    })

    .post('/tasks/:id/gates/redirect', validator('json', validateJson(GateComment)), async (c) => {
      const task = await requireTask(c.req.param('id'))
      const input = c.req.valid('json')

      await performGateAction(() => gates.redirect(task.id, OWNER_ACTOR, input.comment))

      return c.json({ task: await requireTask(task.id) })
    })

    .post('/tasks/:id/gates/rework', validator('json', validateJson(ReworkGate)), async (c) => {
      const task = await requireTask(c.req.param('id'))
      const input = c.req.valid('json')

      await performGateAction(() =>
        gates.rework({
          taskId: task.id,
          actor: OWNER_ACTOR,
          target: input.target,
          comment: input.comment,
        }),
      )

      return c.json({ task: await requireTask(task.id) })
    })
}
