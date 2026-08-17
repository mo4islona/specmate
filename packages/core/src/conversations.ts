import type { ExecutionUsage } from './provider.ts'
import type { ProviderId } from './roles.ts'
import type { TaskState } from './state.ts'
import { isTerminal } from './state.ts'

export const CONVERSATION_STATUSES = ['open', 'closed'] as const
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number]

export const CONVERSATION_MESSAGE_ROLES = ['owner', 'assistant', 'system'] as const
export type ConversationMessageRole = (typeof CONVERSATION_MESSAGE_ROLES)[number]

export const CONVERSATION_MESSAGE_STATUSES = [
  'completed',
  'queued',
  'responding',
  'failed',
] as const
export type ConversationMessageStatus = (typeof CONVERSATION_MESSAGE_STATUSES)[number]

export const CONVERSATION_ACTION_KINDS = [
  'answer_decision',
  'dismiss_decision',
  'approve_gate',
  'redirect_gate',
  'rework_gate',
  'instruct_next_run',
  'restart_stage',
] as const
export type ConversationActionKind = (typeof CONVERSATION_ACTION_KINDS)[number]

export const CONVERSATION_ACTION_STATUSES = [
  'proposed',
  'confirmed',
  'applying',
  'applied',
  'conflict',
  'failed',
] as const
export type ConversationActionStatus = (typeof CONVERSATION_ACTION_STATUSES)[number]

export interface ConversationRecord {
  readonly id: string
  readonly taskId: string
  readonly subjectKind: string | null
  readonly subjectId: string | null
  readonly status: ConversationStatus
  readonly lastSequence: number
  readonly contextCommit: string | null
  readonly contextTaskState: TaskState | null
  readonly summaryMd: string | null
  readonly summaryThrough: number
  readonly providerSession: Record<string, unknown> | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface ConversationMessageRecord {
  readonly id: string
  readonly conversationId: string
  readonly sequence: number
  readonly replyToMessageId: string | null
  readonly role: ConversationMessageRole
  readonly contentMd: string
  readonly status: ConversationMessageStatus
  readonly stageId: string | null
  readonly taskState: TaskState
  readonly contextCommit: string | null
  readonly provider: ProviderId | null
  readonly telemetry: readonly ExecutionUsage[]
  readonly failureReason: string | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface ConversationActionTarget {
  readonly taskId: string
  readonly graphId?: string
  readonly nodeKey?: string
  readonly stageId?: string
  readonly decisionId?: string
  readonly gate?: string
}

export interface ConversationExpectedVersion {
  readonly taskStatus: TaskState
  readonly graphId?: string
  readonly stageId?: string
  readonly attempt?: number
  readonly decisionStatus?: string
}

/** A live, copyable action skeleton supplied to the answer-only role. */
export interface ConversationActionOption {
  readonly kind: ConversationActionKind
  readonly target: ConversationActionTarget
  readonly expectedVersion: ConversationExpectedVersion
  readonly instruction: 'required' | 'optional' | 'omit'
  readonly description: string
}

export interface ConversationActionRecord {
  readonly id: string
  readonly taskId: string
  readonly conversationId: string
  readonly messageId: string
  readonly kind: ConversationActionKind
  readonly target: ConversationActionTarget
  readonly instruction: string | null
  readonly expectedVersion: ConversationExpectedVersion
  readonly actor: string | null
  readonly status: ConversationActionStatus
  readonly outcome: Record<string, unknown> | null
  readonly idempotencyKey: string | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface ConversationTaskContext {
  readonly id: string
  readonly status: TaskState
}

export interface ConversationStageContext {
  readonly id: string
  readonly nodeKey: string
  readonly role: string
  readonly provider: string
}

export interface ConversationEventInput {
  readonly taskId: string
  readonly stageId?: string
  readonly type: string
  readonly payload: Record<string, unknown>
}

export interface ConversationRepository {
  findTask(taskId: string): Promise<ConversationTaskContext | null>
  findConversation(conversationId: string): Promise<ConversationRecord | null>
  findConversationByIdempotencyKey(
    taskId: string,
    idempotencyKey: string,
  ): Promise<ConversationRecord | null>
  findMessagePairByIdempotencyKey(
    taskId: string,
    conversationId: string,
    idempotencyKey: string,
  ): Promise<{ owner: ConversationMessageRecord; response: ConversationMessageRecord } | null>
  findCurrentStage(taskId: string): Promise<ConversationStageContext | null>
  insertConversation(input: {
    taskId: string
    subjectKind?: string
    subjectId?: string
  }): Promise<ConversationRecord>
  allocateSequences(conversationId: string, count: number): Promise<number>
  insertMessage(input: {
    conversationId: string
    sequence: number
    replyToMessageId?: string
    role: ConversationMessageRole
    contentMd: string
    status: ConversationMessageStatus
    stageId?: string
    taskState: TaskState
  }): Promise<ConversationMessageRecord>
  insertFeedback(input: {
    taskId: string
    stageId?: string
    role?: string
    provider?: string
    textMd: string
  }): Promise<void>
  insertEvent(input: ConversationEventInput): Promise<void>
}

export interface ConversationStore {
  transaction<T>(operation: (repository: ConversationRepository) => Promise<T>): Promise<T>
  list(taskId: string): Promise<ConversationRecord[]>
  listMessages(conversationId: string): Promise<ConversationMessageRecord[]>
  listActions(conversationId: string): Promise<ConversationActionRecord[]>
}

export class EmptyConversationMessageError extends Error {
  override readonly name = 'EmptyConversationMessageError'

  constructor() {
    super('message must not be empty')
  }
}

export class ConversationTaskNotFoundError extends Error {
  override readonly name = 'ConversationTaskNotFoundError'

  constructor(taskId: string) {
    super(`task ${taskId} does not exist`)
  }
}

export class ConversationNotFoundError extends Error {
  override readonly name = 'ConversationNotFoundError'

  constructor(conversationId: string) {
    super(`conversation ${conversationId} does not exist`)
  }
}

export class TerminalTaskConversationError extends Error {
  override readonly name = 'TerminalTaskConversationError'

  constructor(taskId: string, status: TaskState) {
    super(`task ${taskId} is ${status}; terminal tasks do not accept conversation messages`)
  }
}

export class ConversationClosedError extends Error {
  override readonly name = 'ConversationClosedError'

  constructor(conversationId: string) {
    super(`conversation ${conversationId} is closed`)
  }
}

export class ConversationSubjectConflictError extends Error {
  override readonly name = 'ConversationSubjectConflictError'

  constructor(taskId: string, subjectKind: string, subjectId: string) {
    super(`task ${taskId} already has a conversation for ${subjectKind} ${subjectId}`)
  }
}

export async function openConversation(
  store: ConversationStore,
  input: { taskId: string; subjectKind?: string; subjectId?: string; idempotencyKey: string },
): Promise<ConversationRecord> {
  return store.transaction(async (repository) => {
    const task = await repository.findTask(input.taskId)
    if (!task) throw new ConversationTaskNotFoundError(input.taskId)

    const existing = await repository.findConversationByIdempotencyKey(
      task.id,
      input.idempotencyKey,
    )
    if (existing) return existing

    if (isTerminal(task.status)) throw new TerminalTaskConversationError(task.id, task.status)

    const conversation = await insertConversationOrConflict(repository, {
      taskId: input.taskId,
      subjectKind: input.subjectKind,
      subjectId: input.subjectId,
    })
    await repository.insertEvent({
      taskId: task.id,
      type: 'conversation.created',
      payload: {
        conversationId: conversation.id,
        subjectKind: conversation.subjectKind,
        subjectId: conversation.subjectId,
        idempotencyKey: input.idempotencyKey,
      },
    })

    return conversation
  })
}

async function insertConversationOrConflict(
  repository: ConversationRepository,
  input: { taskId: string; subjectKind?: string; subjectId?: string },
): Promise<ConversationRecord> {
  try {
    return await repository.insertConversation(input)
  } catch (error) {
    // The store interface has no typed "already exists" result; the partial
    // unique index on (taskId, subjectKind, subjectId) is the only signal a
    // concurrent or retried open collided with an existing conversation.
    if (input.subjectKind && input.subjectId && isUniqueViolation(error)) {
      throw new ConversationSubjectConflictError(input.taskId, input.subjectKind, input.subjectId)
    }

    throw error
  }
}

/**
 * The driver's raw Postgres error usually arrives wrapped in a
 * DrizzleQueryError, so the unique-violation SQLSTATE lives on `.cause`, not
 * on the error itself — and Bun's SQL client carries it as `errno`, not
 * `code` (`code` there is a generic `ERR_POSTGRES_SERVER_ERROR`).
 */
export function isUniqueViolation(error: unknown): boolean {
  let current = error
  while (typeof current === 'object' && current !== null) {
    const withCodes = current as { code?: unknown; errno?: unknown }
    if (withCodes.code === '23505' || withCodes.errno === '23505') return true
    current = (current as { cause?: unknown }).cause
  }

  return false
}

export async function appendOwnerMessage(
  store: ConversationStore,
  input: { conversationId: string; content: string; idempotencyKey: string },
): Promise<{ owner: ConversationMessageRecord; response: ConversationMessageRecord }> {
  const content = input.content.trim()
  if (!content) throw new EmptyConversationMessageError()

  return store.transaction(async (repository) => {
    const conversation = await repository.findConversation(input.conversationId)
    if (!conversation) throw new ConversationNotFoundError(input.conversationId)

    const existing = await repository.findMessagePairByIdempotencyKey(
      conversation.taskId,
      conversation.id,
      input.idempotencyKey,
    )
    if (existing) return existing

    if (conversation.status !== 'open') throw new ConversationClosedError(conversation.id)

    const task = await repository.findTask(conversation.taskId)
    if (!task) throw new ConversationTaskNotFoundError(conversation.taskId)

    if (isTerminal(task.status)) throw new TerminalTaskConversationError(task.id, task.status)

    const currentStage = await repository.findCurrentStage(task.id)
    const lastSequence = await repository.allocateSequences(conversation.id, 2)
    const owner = await repository.insertMessage({
      conversationId: conversation.id,
      sequence: lastSequence - 1,
      role: 'owner',
      contentMd: content,
      status: 'completed',
      stageId: currentStage?.id,
      taskState: task.status,
    })
    const response = await repository.insertMessage({
      conversationId: conversation.id,
      sequence: lastSequence,
      replyToMessageId: owner.id,
      role: 'assistant',
      contentMd: '',
      status: 'queued',
      stageId: currentStage?.id,
      taskState: task.status,
    })
    await repository.insertFeedback({
      taskId: task.id,
      stageId: currentStage?.id,
      role: currentStage?.role,
      provider: currentStage?.provider,
      textMd: content,
    })
    await repository.insertEvent({
      taskId: task.id,
      stageId: currentStage?.id,
      type: 'conversation.message.created',
      payload: {
        conversationId: conversation.id,
        messageId: owner.id,
        responseId: response.id,
        sequence: owner.sequence,
        idempotencyKey: input.idempotencyKey,
      },
    })

    return { owner, response }
  })
}

export function listConversations(
  store: ConversationStore,
  taskId: string,
): Promise<ConversationRecord[]> {
  return store.list(taskId)
}

export async function readConversation(
  store: ConversationStore,
  conversationId: string,
): Promise<{
  messages: ConversationMessageRecord[]
  actions: ConversationActionRecord[]
}> {
  const [messages, actions] = await Promise.all([
    store.listMessages(conversationId),
    store.listActions(conversationId),
  ])

  return { messages, actions }
}
