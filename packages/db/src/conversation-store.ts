import type {
  ConversationActionRecord,
  ConversationMessageRecord,
  ConversationRepository,
  ConversationStore,
} from '@specmate/core'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import type { Database, DbClient } from './index.ts'
import {
  conversationActions,
  conversationMessages,
  conversations,
  events,
  feedback,
  stages,
  tasks,
} from './schema.ts'

type FeedbackRole = typeof feedback.$inferInsert.role
type FeedbackProvider = typeof feedback.$inferInsert.provider

function asMessage(row: typeof conversationMessages.$inferSelect): ConversationMessageRecord {
  return { ...row, telemetry: row.telemetry ?? [] }
}

function asAction(row: typeof conversationActions.$inferSelect): ConversationActionRecord {
  return row
}

function repository(db: DbClient): ConversationRepository {
  return {
    async findTask(taskId) {
      const [task] = await db
        .select({ id: tasks.id, status: tasks.status })
        .from(tasks)
        .where(eq(tasks.id, taskId))
        .limit(1)
        .for('update')

      return task ?? null
    },

    async findConversation(conversationId) {
      const [conversation] = await db
        .select()
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .limit(1)
        .for('update')

      return conversation ?? null
    },

    async findConversationByIdempotencyKey(taskId, idempotencyKey) {
      const [event] = await db
        .select({ payload: events.payload })
        .from(events)
        .where(
          sql`${events.taskId} = ${taskId} and ${events.type} = 'conversation.created' and ${events.payload}->>'idempotencyKey' = ${idempotencyKey}`,
        )
        .limit(1)
      if (!event) return null

      const [conversation] = await db
        .select()
        .from(conversations)
        .where(eq(conversations.id, event.payload.conversationId as string))
        .limit(1)

      return conversation ?? null
    },

    async findMessagePairByIdempotencyKey(taskId, conversationId, idempotencyKey) {
      const [event] = await db
        .select({ payload: events.payload })
        .from(events)
        .where(
          sql`${events.taskId} = ${taskId} and ${events.type} = 'conversation.message.created' and ${events.payload}->>'conversationId' = ${conversationId} and ${events.payload}->>'idempotencyKey' = ${idempotencyKey}`,
        )
        .limit(1)
      if (!event) return null

      const [owner] = await db
        .select()
        .from(conversationMessages)
        .where(eq(conversationMessages.id, event.payload.messageId as string))
        .limit(1)
      const [response] = await db
        .select()
        .from(conversationMessages)
        .where(eq(conversationMessages.id, event.payload.responseId as string))
        .limit(1)
      if (!owner || !response) return null

      return { owner: asMessage(owner), response: asMessage(response) }
    },

    async findCurrentStage(taskId) {
      const [stage] = await db
        .select({
          id: stages.id,
          nodeKey: stages.nodeKey,
          role: stages.role,
          provider: stages.provider,
        })
        .from(stages)
        .where(and(eq(stages.taskId, taskId), eq(stages.status, 'running')))
        .orderBy(desc(stages.createdAt))
        .limit(1)

      return stage ?? null
    },

    async insertConversation(input) {
      const [conversation] = await db.insert(conversations).values(input).returning()
      if (!conversation) throw new Error(`conversation for task ${input.taskId} was not created`)

      return conversation
    },

    async allocateSequences(conversationId, count) {
      const [conversation] = await db
        .update(conversations)
        .set({
          lastSequence: sql`${conversations.lastSequence} + ${count}`,
          updatedAt: new Date(),
        })
        .where(eq(conversations.id, conversationId))
        .returning({ lastSequence: conversations.lastSequence })
      if (!conversation) throw new Error(`conversation ${conversationId} disappeared`)

      return conversation.lastSequence
    },

    async insertMessage(input) {
      const [message] = await db.insert(conversationMessages).values(input).returning()
      if (!message)
        throw new Error(`message for conversation ${input.conversationId} was not created`)

      return asMessage(message)
    },

    async insertFeedback(input) {
      await db.insert(feedback).values({
        taskId: input.taskId,
        stageId: input.stageId,
        role: input.role as FeedbackRole,
        provider: input.provider as FeedbackProvider,
        kind: 'conversation',
        textMd: input.textMd,
      })
    },

    async insertEvent(input) {
      await db.insert(events).values(input)
    },
  }
}

export function createConversationStore(db: Database): ConversationStore {
  return {
    transaction: (operation) => db.transaction((tx) => operation(repository(tx))),
    async list(taskId) {
      return db
        .select()
        .from(conversations)
        .where(eq(conversations.taskId, taskId))
        .orderBy(asc(conversations.createdAt), asc(conversations.id))
    },
    async listMessages(conversationId) {
      const rows = await db
        .select()
        .from(conversationMessages)
        .where(eq(conversationMessages.conversationId, conversationId))
        .orderBy(asc(conversationMessages.sequence))

      return rows.map(asMessage)
    },
    async listActions(conversationId) {
      const rows = await db
        .select()
        .from(conversationActions)
        .where(eq(conversationActions.conversationId, conversationId))
        .orderBy(asc(conversationActions.createdAt), asc(conversationActions.id))

      return rows.map(asAction)
    },
  }
}
