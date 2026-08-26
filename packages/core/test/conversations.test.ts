import { assert, describe, expect, test } from 'vitest'
import {
  appendOwnerMessage,
  type ConversationActionRecord,
  type ConversationEventInput,
  type ConversationMessageRecord,
  type ConversationRecord,
  type ConversationRepository,
  type ConversationStore,
  MESSAGE_WINDOW,
  openConversation,
  readConversation,
  TerminalTaskConversationError,
} from '../src/index.ts'
import type { TaskState } from '../src/state-schemas.ts'

class MemoryConversationStore implements ConversationStore {
  readonly conversations: ConversationRecord[] = []
  readonly messages: ConversationMessageRecord[] = []
  readonly actions: ConversationActionRecord[] = []
  readonly feedback: unknown[] = []
  readonly events: ConversationEventInput[] = []
  readonly tasks = new Map<string, TaskState>()

  readonly repository: ConversationRepository = {
    findTask: async (taskId) => {
      const status = this.tasks.get(taskId)

      return status ? { id: taskId, status } : null
    },
    findConversation: async (id) => this.conversations.find((item) => item.id === id) ?? null,
    findConversationByIdempotencyKey: async (taskId, idempotencyKey) => {
      const event = this.events.find(
        (item) =>
          item.type === 'conversation.created' &&
          item.taskId === taskId &&
          item.payload.idempotencyKey === idempotencyKey,
      )
      if (!event) return null

      return this.conversations.find((item) => item.id === event.payload.conversationId) ?? null
    },
    findMessagePairByIdempotencyKey: async (taskId, conversationId, idempotencyKey) => {
      const event = this.events.find(
        (item) =>
          item.type === 'conversation.message.created' &&
          item.taskId === taskId &&
          item.payload.conversationId === conversationId &&
          item.payload.idempotencyKey === idempotencyKey,
      )
      if (!event) return null

      const owner = this.messages.find((item) => item.id === event.payload.messageId)
      const response = this.messages.find((item) => item.id === event.payload.responseId)

      return owner && response ? { owner, response } : null
    },
    findCurrentStage: async () => ({
      id: 'stage-1',
      nodeKey: 'research',
      role: 'researcher',
      provider: 'claude-code',
    }),
    insertConversation: async (input) => {
      const now = new Date('2026-08-16T10:00:00.000Z')
      const conversation: ConversationRecord = {
        id: `conversation-${this.conversations.length + 1}`,
        taskId: input.taskId,
        subjectKind: input.subjectKind ?? null,
        subjectId: input.subjectId ?? null,
        status: 'open',
        lastSequence: 0,
        contextCommit: null,
        contextTaskState: null,
        summaryMd: null,
        summaryThrough: 0,
        providerSession: null,
        createdAt: now,
        updatedAt: now,
      }
      this.conversations.push(conversation)

      return conversation
    },
    allocateSequences: async (conversationId, count) => {
      const at = this.conversations.findIndex((item) => item.id === conversationId)
      const current = this.conversations[at]
      assert(current)
      const updated = { ...current, lastSequence: current.lastSequence + count }
      this.conversations[at] = updated

      return updated.lastSequence
    },
    insertMessage: async (input) => {
      const now = new Date('2026-08-16T10:00:00.000Z')
      const message: ConversationMessageRecord = {
        id: `message-${this.messages.length + 1}`,
        ...input,
        replyToMessageId: input.replyToMessageId ?? null,
        stageId: input.stageId ?? null,
        contextCommit: null,
        provider: null,
        telemetry: [],
        failureReason: null,
        createdAt: now,
        updatedAt: now,
      }
      this.messages.push(message)

      return message
    },
    insertFeedback: async (input) => {
      this.feedback.push(input)
    },
    insertEvent: async (input) => {
      this.events.push(input)
    },
  }

  transaction<T>(operation: (repository: ConversationRepository) => Promise<T>): Promise<T> {
    return operation(this.repository)
  }

  async list(taskId: string): Promise<ConversationRecord[]> {
    return this.conversations.filter((item) => item.taskId === taskId)
  }

  async listMessages(
    conversationId: string,
    newest?: number,
  ): Promise<ConversationMessageRecord[]> {
    const all = this.messages.filter((item) => item.conversationId === conversationId)

    return newest === undefined ? all : all.slice(-newest)
  }

  async listActions(conversationId: string): Promise<ConversationActionRecord[]> {
    return this.actions.filter((item) => item.conversationId === conversationId)
  }
}

describe('conversation operations', () => {
  test('opens a durable conversation without moving the task', async () => {
    const store = new MemoryConversationStore()
    store.tasks.set('task-1', 'research')

    const conversation = await openConversation(store, {
      taskId: 'task-1',
      idempotencyKey: 'open-1',
    })

    expect(conversation).toMatchObject({ taskId: 'task-1', status: 'open' })
    expect(store.tasks.get('task-1')).toBe('research')
    expect(store.events).toEqual([expect.objectContaining({ type: 'conversation.created' })])
  })

  test('replays the same conversation for a repeated idempotency key', async () => {
    const store = new MemoryConversationStore()
    store.tasks.set('task-1', 'research')

    const first = await openConversation(store, { taskId: 'task-1', idempotencyKey: 'open-1' })
    const second = await openConversation(store, { taskId: 'task-1', idempotencyKey: 'open-1' })

    expect(second).toEqual(first)
    expect(store.conversations).toHaveLength(1)
  })

  test('appends an owner message and a FIFO response placeholder atomically', async () => {
    const store = new MemoryConversationStore()
    store.tasks.set('task-1', 'research')
    const conversation = await openConversation(store, {
      taskId: 'task-1',
      idempotencyKey: 'open-1',
    })

    const result = await appendOwnerMessage(store, {
      conversationId: conversation.id,
      content: '  What changed?  ',
      idempotencyKey: 'message-1',
    })

    expect(result.owner).toMatchObject({ sequence: 1, role: 'owner', contentMd: 'What changed?' })
    expect(result.response).toMatchObject({ sequence: 2, role: 'assistant', status: 'queued' })
    expect(result.response.replyToMessageId).toBe(result.owner.id)
    expect(store.feedback).toEqual([
      expect.objectContaining({ stageId: 'stage-1', textMd: 'What changed?' }),
    ])
  })

  test('replays the same message pair for a repeated idempotency key', async () => {
    const store = new MemoryConversationStore()
    store.tasks.set('task-1', 'research')
    const conversation = await openConversation(store, {
      taskId: 'task-1',
      idempotencyKey: 'open-1',
    })

    const first = await appendOwnerMessage(store, {
      conversationId: conversation.id,
      content: 'What changed?',
      idempotencyKey: 'message-1',
    })
    const second = await appendOwnerMessage(store, {
      conversationId: conversation.id,
      content: 'What changed?',
      idempotencyKey: 'message-1',
    })

    expect(second).toEqual(first)
    expect(store.messages).toHaveLength(2)
    expect(store.feedback).toHaveLength(1)
  })

  /**
   * A discussion is drawn from its end, and every message in it is a body of
   * markdown to parse and lay out — so a read is bounded the way the timeline's
   * is. The record keeps all of it; this is what one read hands over.
   */
  test('a read returns the newest messages and no more', async () => {
    const store = new MemoryConversationStore()
    store.tasks.set('task-1', 'implement')
    const conversation = await openConversation(store, { taskId: 'task-1', idempotencyKey: 'open' })

    // Each turn is two records — what was asked, and the reply queued for it.
    for (let n = 0; n < MESSAGE_WINDOW; n++) {
      await appendOwnerMessage(store, {
        conversationId: conversation.id,
        content: `message ${n}`,
        idempotencyKey: `message-${n}`,
      })
    }

    const said = store.messages.length
    const read = await readConversation(store, conversation.id)

    expect(said).toBeGreaterThan(MESSAGE_WINDOW)
    expect(read.messages).toHaveLength(MESSAGE_WINDOW)
    expect(read.messages.at(-1)?.sequence).toBe(said)
    expect(read.messages.at(0)?.sequence).toBe(said - MESSAGE_WINDOW + 1)
  })

  test('rejects new conversation work on terminal tasks', async () => {
    const store = new MemoryConversationStore()
    store.tasks.set('task-1', 'archived')

    await expect(
      openConversation(store, { taskId: 'task-1', idempotencyKey: 'open-1' }),
    ).rejects.toThrow(TerminalTaskConversationError)
  })
})
