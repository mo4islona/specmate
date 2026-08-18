import type { AppType } from '@specmate/api'
import type { InferRequestType, InferResponseType } from 'hono/client'
import { hc } from 'hono/client'
import { clearSecret, getSecret } from './secret-store.ts'

const baseUrl = typeof window === 'undefined' ? 'http://localhost' : window.location.origin

export type HttpFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export async function ownerFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  fetcher: HttpFetch = fetch,
): Promise<Response> {
  const response = await fetcher(input, init)
  if (response.status === 401) {
    clearSecret()
  }

  return response
}

export function ownerHeaders(): Record<string, string> {
  const secret = getSecret()

  return secret ? { authorization: `Bearer ${secret}` } : {}
}

export const apiClient = hc<AppType>(baseUrl, {
  fetch: ownerFetch,
  headers: ownerHeaders,
})

interface ApiErrorPayload {
  code?: string
  detail?: string
  fields?: Record<string, string[]>
}

export class ApiRequestError extends Error {
  override readonly name = 'ApiRequestError'

  constructor(
    readonly status: number,
    readonly code: string,
    readonly fields: Record<string, string[]> = {},
    detail = 'Request failed',
  ) {
    super(detail)
  }
}

async function readJson<T>(response: {
  ok: boolean
  status: number
  json(): Promise<unknown>
}): Promise<T> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ApiRequestError(response.status, 'internal', {}, 'Request failed')
  }

  if (!response.ok) {
    const error = body as ApiErrorPayload
    throw new ApiRequestError(response.status, error.code ?? 'internal', error.fields, error.detail)
  }

  return body as T
}

type TasksResponse = InferResponseType<typeof apiClient.api.v1.tasks.$get, 200>
type AttentionResponse = InferResponseType<typeof apiClient.api.v1.attention.$get, 200>
type TaskResponse = InferResponseType<(typeof apiClient.api.v1.tasks)[':id']['$get'], 200>
type EventsResponse = InferResponseType<
  (typeof apiClient.api.v1.tasks)[':id']['events']['$get'],
  200
>
export type ConversationsResponse = InferResponseType<
  (typeof apiClient.api.v1.tasks)[':id']['conversations']['$get'],
  200
>
type CreateConversationResponse = InferResponseType<
  (typeof apiClient.api.v1.tasks)[':id']['conversations']['$post'],
  201
>
export type ConversationResponse = InferResponseType<
  (typeof apiClient.api.v1.tasks)[':id']['conversations'][':conversationId']['$get'],
  200
>
type ConversationMessageResponse = InferResponseType<
  (typeof apiClient.api.v1.tasks)[':id']['conversations'][':conversationId']['messages']['$post'],
  201
>
type ArtifactsResponse = InferResponseType<
  (typeof apiClient.api.v1.tasks)[':id']['artifacts']['$get'],
  200
>
type ArtifactResponse = InferResponseType<
  (typeof apiClient.api.v1.tasks)[':id']['artifacts'][':artifactId']['$get'],
  200
>
type DiffFilesResponse = InferResponseType<
  (typeof apiClient.api.v1.tasks)[':id']['diff']['files']['$get'],
  200
>
type FileDiffResponse = InferResponseType<
  (typeof apiClient.api.v1.tasks)[':id']['diff']['file']['$get'],
  200
>
type CreateTaskRequest = InferRequestType<typeof apiClient.api.v1.tasks.$post>
type FeedbackRequest = InferRequestType<(typeof apiClient.api.v1.tasks)[':id']['feedback']['$post']>
type ConversationMessageRequest = InferRequestType<
  (typeof apiClient.api.v1.tasks)[':id']['conversations'][':conversationId']['messages']['$post']
>
type FeedbackResponse = InferResponseType<
  (typeof apiClient.api.v1.tasks)[':id']['feedback']['$post'],
  201
>
type RedirectRequest = InferRequestType<
  (typeof apiClient.api.v1.tasks)[':id']['gates']['redirect']['$post']
>
type ReworkRequest = InferRequestType<
  (typeof apiClient.api.v1.tasks)[':id']['gates']['rework']['$post']
>
type StopStageRequest = InferRequestType<
  (typeof apiClient.api.v1.tasks)[':id']['stages']['stop']['$post']
>
type RestartStageRequest = InferRequestType<
  (typeof apiClient.api.v1.tasks)[':id']['stages']['restart']['$post']
>
type DecisionsResponse = InferResponseType<
  (typeof apiClient.api.v1.tasks)[':id']['decisions']['$get'],
  200
>
type AnswerDecisionRequest = InferRequestType<
  (typeof apiClient.api.v1.decisions)[':id']['answer']['$post']
>
type DismissDecisionRequest = InferRequestType<
  (typeof apiClient.api.v1.decisions)[':id']['dismiss']['$post']
>

export type TaskSummary = TasksResponse['tasks'][number]
export type AttentionItem = AttentionResponse['items'][number]
export type TaskDetail = TaskResponse
export type TimelineEvent = EventsResponse['events'][number]
export type TimelineResponse = EventsResponse
export type ConversationItem = ConversationsResponse['conversations'][number]
export type ConversationMessage = ConversationResponse['messages'][number]
export type ConversationAction = ConversationResponse['actions'][number]
export type ArtifactSummary = ArtifactsResponse['artifacts'][number]
export type ArtifactDetail = ArtifactResponse['artifact']
export type DiffFileSummary = DiffFilesResponse['files'][number]
export type FileDiff = FileDiffResponse
export type CreateTaskInput = CreateTaskRequest['json']
export type FeedbackInput = FeedbackRequest['json']
export type ConversationMessageInput = Omit<ConversationMessageRequest['json'], 'idempotencyKey'>
export type RedirectInput = RedirectRequest['json']
export type ReworkInput = ReworkRequest['json']
export type StopStageInput = StopStageRequest['json']
export type RestartStageInput = RestartStageRequest['json']
export type DecisionItem = DecisionsResponse['decisions'][number]
export type AnswerDecisionInput = AnswerDecisionRequest['json']
export type DismissDecisionInput = DismissDecisionRequest['json']

export async function listTasks(signal?: AbortSignal): Promise<TasksResponse> {
  const response = await apiClient.api.v1.tasks.$get(undefined, { init: { signal } })

  return readJson<TasksResponse>(response)
}

export async function listAttention(signal?: AbortSignal): Promise<AttentionResponse> {
  const response = await apiClient.api.v1.attention.$get(undefined, { init: { signal } })

  return readJson<AttentionResponse>(response)
}

export async function getTask(taskId: string, signal?: AbortSignal): Promise<TaskResponse> {
  const response = await apiClient.api.v1.tasks[':id'].$get(
    { param: { id: taskId } },
    { init: { signal } },
  )

  return readJson<TaskResponse>(response)
}

export async function createTask(input: CreateTaskInput): Promise<{ task: TaskSummary }> {
  const response = await apiClient.api.v1.tasks.$post({ json: input })

  return readJson<{ task: TaskSummary }>(response)
}

export async function listEvents(taskId: string, signal?: AbortSignal): Promise<EventsResponse> {
  const response = await apiClient.api.v1.tasks[':id'].events.$get(
    { param: { id: taskId } },
    { init: { signal } },
  )

  return readJson<EventsResponse>(response)
}

export async function listConversations(taskId: string): Promise<ConversationsResponse> {
  const response = await apiClient.api.v1.tasks[':id'].conversations.$get({ param: { id: taskId } })

  return readJson<ConversationsResponse>(response)
}

export async function createConversation(taskId: string): Promise<CreateConversationResponse> {
  const response = await apiClient.api.v1.tasks[':id'].conversations.$post({
    param: { id: taskId },
    json: { idempotencyKey: crypto.randomUUID() },
  })

  return readJson<CreateConversationResponse>(response)
}

export async function getConversation(
  taskId: string,
  conversationId: string,
): Promise<ConversationResponse> {
  const response = await apiClient.api.v1.tasks[':id'].conversations[':conversationId'].$get({
    param: { id: taskId, conversationId },
  })

  return readJson<ConversationResponse>(response)
}

export async function postConversationMessage(
  taskId: string,
  conversationId: string,
  input: ConversationMessageInput,
): Promise<ConversationMessageResponse> {
  const response = await apiClient.api.v1.tasks[':id'].conversations[
    ':conversationId'
  ].messages.$post({
    param: { id: taskId, conversationId },
    json: { ...input, idempotencyKey: crypto.randomUUID() },
  })

  return readJson<ConversationMessageResponse>(response)
}

export async function confirmConversationAction(
  taskId: string,
  conversationId: string,
  actionId: string,
): Promise<{ task: TaskSummary }> {
  const response = await apiClient.api.v1.tasks[':id'].conversations[':conversationId'].actions[
    ':actionId'
  ].confirm.$post({
    param: { id: taskId, conversationId, actionId },
    json: { idempotencyKey: `confirm:${actionId}` },
  })

  return readJson<{ task: TaskSummary }>(response)
}

export async function stopStage(
  taskId: string,
  input: StopStageInput,
): Promise<{ task: TaskSummary }> {
  const response = await apiClient.api.v1.tasks[':id'].stages.stop.$post({
    param: { id: taskId },
    json: input,
  })

  return readJson<{ task: TaskSummary }>(response)
}

export async function restartStage(
  taskId: string,
  input: RestartStageInput,
): Promise<{ task: TaskSummary }> {
  const response = await apiClient.api.v1.tasks[':id'].stages.restart.$post({
    param: { id: taskId },
    json: input,
  })

  return readJson<{ task: TaskSummary }>(response)
}

export async function postFeedback(
  taskId: string,
  input: FeedbackInput,
): Promise<FeedbackResponse> {
  const response = await apiClient.api.v1.tasks[':id'].feedback.$post({
    param: { id: taskId },
    json: input,
  })

  return readJson<FeedbackResponse>(response)
}

export async function approveGate(taskId: string): Promise<{ task: TaskSummary }> {
  const response = await apiClient.api.v1.tasks[':id'].gates.approve.$post({
    param: { id: taskId },
  })

  return readJson<{ task: TaskSummary }>(response)
}

export async function redirectGate(
  taskId: string,
  input: RedirectInput,
): Promise<{ task: TaskSummary }> {
  const response = await apiClient.api.v1.tasks[':id'].gates.redirect.$post({
    param: { id: taskId },
    json: input,
  })

  return readJson<{ task: TaskSummary }>(response)
}

export async function reworkGate(
  taskId: string,
  input: ReworkInput,
): Promise<{ task: TaskSummary }> {
  const response = await apiClient.api.v1.tasks[':id'].gates.rework.$post({
    param: { id: taskId },
    json: input,
  })

  return readJson<{ task: TaskSummary }>(response)
}

export async function listDecisions(
  taskId: string,
  signal?: AbortSignal,
): Promise<DecisionsResponse> {
  const response = await apiClient.api.v1.tasks[':id'].decisions.$get(
    { param: { id: taskId } },
    { init: { signal } },
  )

  return readJson<DecisionsResponse>(response)
}

export async function answerDecision(
  decisionId: string,
  input: AnswerDecisionInput,
): Promise<{ task: TaskSummary }> {
  const response = await apiClient.api.v1.decisions[':id'].answer.$post({
    param: { id: decisionId },
    json: input,
  })

  return readJson<{ task: TaskSummary }>(response)
}

export async function dismissDecision(
  decisionId: string,
  input: DismissDecisionInput,
): Promise<{ task: TaskSummary }> {
  const response = await apiClient.api.v1.decisions[':id'].dismiss.$post({
    param: { id: decisionId },
    json: input,
  })

  return readJson<{ task: TaskSummary }>(response)
}

export async function listArtifacts(
  taskId: string,
  signal?: AbortSignal,
): Promise<ArtifactsResponse> {
  const response = await apiClient.api.v1.tasks[':id'].artifacts.$get(
    { param: { id: taskId } },
    { init: { signal } },
  )

  return readJson<ArtifactsResponse>(response)
}

export async function getArtifact(
  taskId: string,
  artifactId: string,
  signal?: AbortSignal,
): Promise<ArtifactResponse> {
  const response = await apiClient.api.v1.tasks[':id'].artifacts[':artifactId'].$get(
    { param: { id: taskId, artifactId } },
    { init: { signal } },
  )

  return readJson<ArtifactResponse>(response)
}

export async function listDiffFiles(
  taskId: string,
  signal?: AbortSignal,
): Promise<DiffFilesResponse> {
  const response = await apiClient.api.v1.tasks[':id'].diff.files.$get(
    { param: { id: taskId } },
    { init: { signal } },
  )

  return readJson<DiffFilesResponse>(response)
}

export async function getFileDiff(
  taskId: string,
  path: string,
  signal?: AbortSignal,
): Promise<FileDiffResponse> {
  const response = await apiClient.api.v1.tasks[':id'].diff.file.$get(
    { param: { id: taskId }, query: { path } },
    { init: { signal } },
  )

  return readJson<FileDiffResponse>(response)
}
