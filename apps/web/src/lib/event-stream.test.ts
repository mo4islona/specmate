import { afterEach, describe, expect, test } from 'bun:test'
import type { TimelineEvent } from './api-client.ts'
import { consumeTaskEventStream, type EventFetch } from './event-stream.ts'
import { clearSecret, getSecret, setSecret } from './secret-store.ts'

afterEach(() => clearSecret())

function eventFrame(seq: number): string {
  return `id: ${seq}\nevent: stage.completed\ndata: ${JSON.stringify({
    seq,
    taskId: 'task-1',
    stageId: null,
    type: 'stage.completed',
    payload: { seq },
    createdAt: '2026-08-16T12:00:00.000Z',
  })}\n\n`
}

function streamResponse(body: string): Response {
  const bytes = new TextEncoder().encode(body)

  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(bytes)
        controller.close()
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  )
}

describe('consumeTaskEventStream', () => {
  test('resumes from the latest cursor and ignores replayed duplicates', async () => {
    const requests: RequestInit[] = []
    const responses = [
      streamResponse(eventFrame(5) + eventFrame(6)),
      streamResponse(eventFrame(6) + eventFrame(7)),
    ]
    const controller = new AbortController()
    const delivered: TimelineEvent[] = []
    const connections: string[] = []
    const fetcher: EventFetch = async (_input, init) => {
      requests.push(init ?? {})
      const response = responses.shift()
      if (!response) throw new Error('unexpected reconnect')

      return response
    }

    await consumeTaskEventStream({
      taskId: 'task-1',
      secret: 'owner-secret',
      initialCursor: 5,
      signal: controller.signal,
      fetcher,
      retryDelayMs: 0,
      onConnection: (state) => connections.push(state),
      onEvent: (event) => {
        delivered.push(event)
        if (event.seq === 7) controller.abort()
      },
    })

    expect(delivered.map((event) => event.seq)).toEqual([6, 7])
    expect(new Headers(requests[0]?.headers).get('Last-Event-ID')).toBe('5')
    expect(new Headers(requests[1]?.headers).get('Last-Event-ID')).toBe('6')
    expect(new Headers(requests[0]?.headers).get('authorization')).toBe('Bearer owner-secret')
    expect(connections).toEqual(['connecting', 'live', 'stale', 'live'])
  })

  test('clears a rejected stream secret instead of retrying it', async () => {
    setSecret('wrong-secret')
    const controller = new AbortController()

    await consumeTaskEventStream({
      taskId: 'task-1',
      secret: 'wrong-secret',
      signal: controller.signal,
      fetcher: async () => new Response(null, { status: 401 }),
      onConnection: () => undefined,
      onEvent: () => undefined,
    })

    expect(getSecret()).toBeNull()
  })
})
