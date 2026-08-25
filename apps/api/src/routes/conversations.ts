import {
  appendOwnerMessage,
  listConversations,
  openConversation,
  readConversation,
} from '@specmate/core'
import { conversationActions, conversations } from '@specmate/db'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { ApiError } from '../errors.ts'
import { OWNER_ACTOR, type RouteContext } from './context.ts'
import {
  ConfirmConversationAction,
  CreateConversation,
  CreateConversationMessage,
} from './schemas.ts'
import { validateJson } from './validation.ts'

/** A thread on a task, and the actions a stage asked the owner to confirm inside one. */
export function conversationRoutes(ctx: RouteContext) {
  const {
    db,
    gates,
    conversationStore,
    requireTask,
    performConversationOperation,
    performGateAction,
  } = ctx

  return new Hono()
    .post(
      '/tasks/:id/conversations',
      validator('json', validateJson(CreateConversation)),
      async (c) => {
        const input = c.req.valid('json')
        const conversation = await performConversationOperation(() =>
          openConversation(conversationStore, { taskId: c.req.param('id'), ...input }),
        )

        return c.json({ conversation }, 201)
      },
    )

    .get('/tasks/:id/conversations', async (c) => {
      const task = await requireTask(c.req.param('id'))

      return c.json({ conversations: await listConversations(conversationStore, task.id) })
    })

    .post(
      '/tasks/:id/conversations/:conversationId/messages',
      validator('json', validateJson(CreateConversationMessage)),
      async (c) => {
        const task = await requireTask(c.req.param('id'))
        const [conversation] = await db
          .select({ id: conversations.id })
          .from(conversations)
          .where(
            and(
              eq(conversations.id, c.req.param('conversationId')),
              eq(conversations.taskId, task.id),
            ),
          )
          .limit(1)
        if (!conversation) {
          throw new ApiError('not_found', 'conversation was not found for this task', {
            status: 404,
          })
        }
        const result = await performConversationOperation(() =>
          appendOwnerMessage(conversationStore, {
            conversationId: conversation.id,
            content: c.req.valid('json').message,
            idempotencyKey: c.req.valid('json').idempotencyKey,
          }),
        )

        return c.json({ message: result.owner, response: result.response }, 201)
      },
    )

    .get('/tasks/:id/conversations/:conversationId', async (c) => {
      const task = await requireTask(c.req.param('id'))
      const [conversation] = await db
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.id, c.req.param('conversationId')),
            eq(conversations.taskId, task.id),
          ),
        )
        .limit(1)
      if (!conversation) {
        throw new ApiError('not_found', 'conversation was not found for this task', { status: 404 })
      }

      return c.json({
        conversation,
        ...(await readConversation(conversationStore, conversation.id)),
      })
    })

    .post(
      '/tasks/:id/conversations/:conversationId/actions/:actionId/confirm',
      validator('json', validateJson(ConfirmConversationAction)),
      async (c) => {
        const task = await requireTask(c.req.param('id'))
        const [action] = await db
          .select({ id: conversationActions.id })
          .from(conversationActions)
          .where(
            and(
              eq(conversationActions.id, c.req.param('actionId')),
              eq(conversationActions.taskId, task.id),
              eq(conversationActions.conversationId, c.req.param('conversationId')),
            ),
          )
          .limit(1)
        if (!action) {
          throw new ApiError('not_found', 'conversation action was not found', { status: 404 })
        }
        await performGateAction(() =>
          gates.confirmAction({
            taskId: task.id,
            actionId: c.req.param('actionId'),
            actor: OWNER_ACTOR,
            idempotencyKey: c.req.valid('json').idempotencyKey,
          }),
        )

        return c.json({ task: await requireTask(task.id) })
      },
    )
}
