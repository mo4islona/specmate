import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { TimelineEvent } from '../lib/api-client.ts'
import { consumeTaskEventStream, type StreamConnectionState } from '../lib/event-stream.ts'
import { queryKeys } from '../lib/query-keys.ts'
import { getSecret } from '../lib/secret-store.ts'

interface EventsCache {
  events: TimelineEvent[]
}

/** Mirrors the server's GET /tasks/:id/events window so the cache can't grow past what a refetch would return. */
const EVENT_WINDOW = 200

export function mergeTimelineEvents(
  current: TimelineEvent[],
  incoming: TimelineEvent,
): TimelineEvent[] {
  const bySequence = new Map(current.map((event) => [event.seq, event]))
  bySequence.set(incoming.seq, incoming)

  return [...bySequence.values()].sort((left, right) => left.seq - right.seq).slice(-EVENT_WINDOW)
}

export function useTaskStream(taskId: string): StreamConnectionState {
  const queryClient = useQueryClient()
  const [connection, setConnection] = useState<StreamConnectionState>('connecting')

  useEffect(() => {
    const secret = getSecret()
    if (!secret) {
      setConnection('stale')

      return
    }

    const controller = new AbortController()
    const cached = queryClient.getQueryData<EventsCache>(queryKeys.events(taskId))
    const initialCursor = cached?.events.at(-1)?.seq ?? 0
    void consumeTaskEventStream({
      taskId,
      secret,
      initialCursor,
      signal: controller.signal,
      onConnection: setConnection,
      onEvent: (event) => {
        queryClient.setQueryData<EventsCache>(queryKeys.events(taskId), (current) => ({
          events: mergeTimelineEvents(current?.events ?? [], event),
        }))
        void queryClient.invalidateQueries({ queryKey: queryKeys.task(taskId) })
        void queryClient.invalidateQueries({ queryKey: queryKeys.tasks })
        void queryClient.invalidateQueries({ queryKey: queryKeys.attention })
        if (event.type.includes('artifact') || event.type === 'stage.completed') {
          void queryClient.invalidateQueries({ queryKey: queryKeys.artifacts(taskId) })
        }
      },
    })

    return () => controller.abort()
  }, [queryClient, taskId])

  return connection
}
