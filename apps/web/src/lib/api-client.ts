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
  const body = await response.json()
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
type ArtifactsResponse = InferResponseType<
  (typeof apiClient.api.v1.tasks)[':id']['artifacts']['$get'],
  200
>
type ArtifactResponse = InferResponseType<
  (typeof apiClient.api.v1.tasks)[':id']['artifacts'][':artifactId']['$get'],
  200
>
type CreateTaskRequest = InferRequestType<typeof apiClient.api.v1.tasks.$post>
type FeedbackRequest = InferRequestType<(typeof apiClient.api.v1.tasks)[':id']['feedback']['$post']>
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

export type TaskSummary = TasksResponse['tasks'][number]
export type AttentionItem = AttentionResponse['items'][number]
export type TaskDetail = TaskResponse
export type TimelineEvent = EventsResponse['events'][number]
export type TimelineResponse = EventsResponse
export type ArtifactSummary = ArtifactsResponse['artifacts'][number]
export type ArtifactDetail = ArtifactResponse['artifact']
export type CreateTaskInput = CreateTaskRequest['json']
export type FeedbackInput = FeedbackRequest['json']
export type RedirectInput = RedirectRequest['json']
export type ReworkInput = ReworkRequest['json']

export async function listTasks(): Promise<TasksResponse> {
  const response = await apiClient.api.v1.tasks.$get()

  return readJson<TasksResponse>(response)
}

export async function listAttention(): Promise<AttentionResponse> {
  const response = await apiClient.api.v1.attention.$get()

  return readJson<AttentionResponse>(response)
}

export async function getTask(taskId: string): Promise<TaskResponse> {
  const response = await apiClient.api.v1.tasks[':id'].$get({ param: { id: taskId } })

  return readJson<TaskResponse>(response)
}

export async function createTask(input: CreateTaskInput): Promise<{ task: TaskSummary }> {
  const response = await apiClient.api.v1.tasks.$post({ json: input })

  return readJson<{ task: TaskSummary }>(response)
}

export async function listEvents(taskId: string): Promise<EventsResponse> {
  const response = await apiClient.api.v1.tasks[':id'].events.$get({ param: { id: taskId } })

  return readJson<EventsResponse>(response)
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

export async function listArtifacts(taskId: string): Promise<ArtifactsResponse> {
  const response = await apiClient.api.v1.tasks[':id'].artifacts.$get({
    param: { id: taskId },
  })

  return readJson<ArtifactsResponse>(response)
}

export async function getArtifact(taskId: string, artifactId: string): Promise<ArtifactResponse> {
  const response = await apiClient.api.v1.tasks[':id'].artifacts[':artifactId'].$get({
    param: { id: taskId, artifactId },
  })

  return readJson<ArtifactResponse>(response)
}
