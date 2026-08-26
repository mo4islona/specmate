import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { listEvents, type TimelineEvent } from '../lib/api-client.ts'
import { consumeTaskEventStream, type StreamConnectionState } from '../lib/event-stream.ts'
import { queryKeys } from '../lib/query-keys.ts'
import { getSecret } from '../lib/secret-store.ts'

interface EventsCache {
  events: TimelineEvent[]
}

/** Mirrors the server's GET /tasks/:id/events window so the cache can't grow past what a refetch would return. */
const EVENT_WINDOW = 200

/** A whole page folded into the window: one entry per sequence, oldest first, newest kept. */
export function mergeTimelinePage(
  current: readonly TimelineEvent[],
  incoming: readonly TimelineEvent[],
): TimelineEvent[] {
  const bySequence = new Map(current.map((event) => [event.seq, event]))
  for (const event of incoming) bySequence.set(event.seq, event)

  return [...bySequence.values()].sort((left, right) => left.seq - right.seq).slice(-EVENT_WINDOW)
}

export function mergeTimelineEvents(
  current: TimelineEvent[],
  incoming: TimelineEvent,
): TimelineEvent[] {
  // The stream delivers in order, and a tool-heavy stage delivers dozens a
  // second: an event newer than everything held is the case that has to be
  // cheap. Rebuilding a map of the whole window and sorting it again is what
  // made a burst of fifty events fifty sorts of two hundred.
  const newest = current.at(-1)
  if (!newest || incoming.seq > newest.seq) {
    const appended = [...current, incoming]

    return appended.length > EVENT_WINDOW ? appended.slice(-EVENT_WINDOW) : appended
  }

  return mergeTimelinePage(current, [incoming])
}

/**
 * How long a burst of events is allowed to accumulate before what it touched is
 * refetched. Events do not arrive one at a time: a connect replays the whole
 * window at once, and a tool-heavy stage emits dozens a second. Invalidating as
 * each one lands made every burst a refetch per event per query — and because
 * an invalidation cancels the fetch already in flight, the network filled with
 * hundreds of copies of the same request instead of one answer.
 */
const FLUSH_MS = 250

/**
 * Where the live stream picks up.
 *
 * The server replays every event after the cursor it is given, in pages, until
 * it has caught up — so a cold load asking for zero replayed the task's whole
 * history one event at a time into a cache that only keeps the newest two
 * hundred. The thread drew the *beginning* of the task, event by event, and
 * then dropped all of it the moment the page it actually shows arrived.
 *
 * The page the screen reads is the cursor: the stream starts where that page
 * ends, and nothing is replayed twice. A page that cannot be read falls back to
 * zero, because a thread that replays too much still beats one that goes blind.
 */
async function streamCursor(client: QueryClient, taskId: string): Promise<number> {
  const cached = client.getQueryData<EventsCache>(queryKeys.events(taskId))
  if (cached) return cached.events.at(-1)?.seq ?? 0

  const page = await client
    .fetchQuery({
      queryKey: queryKeys.events(taskId),
      queryFn: ({ signal }) => listEvents(taskId, signal),
    })
    .catch(() => null)

  return page?.events.at(-1)?.seq ?? 0
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
    const stale = new Map<string, { queryKey: readonly unknown[]; exact: boolean }>()
    let flush: ReturnType<typeof setTimeout> | null = null

    function invalidateSoon(queryKey: readonly unknown[], exact = false): void {
      stale.set(`${JSON.stringify(queryKey)}:${exact}`, { queryKey, exact })
      if (flush) return

      flush = setTimeout(() => {
        flush = null
        for (const entry of stale.values()) void queryClient.invalidateQueries(entry)
        stale.clear()
      }, FLUSH_MS)
    }

    void open(secret)

    async function open(secret: string): Promise<void> {
      const initialCursor = await streamCursor(queryClient, taskId)
      if (controller.signal.aborted) return

      await consumeTaskEventStream({
        taskId,
        secret,
        initialCursor,
        signal: controller.signal,
        onConnection: setConnection,
        onEvent,
      })
    }

    function onEvent(event: TimelineEvent): void {
      queryClient.setQueryData<EventsCache>(queryKeys.events(taskId), (current) => ({
        events: mergeTimelineEvents(current?.events ?? [], event),
      }))
      // stage.activity fires many times a second during a tool-heavy stage
      // and changes nothing about the task's own state — the timeline cache
      // above is all it needs. Invalidating task/tasks/attention on every
      // one would refetch across unrelated screens for no reason.
      if (event.type !== 'stage.activity') {
        // Exactly the task's own row: its documents, its file diff and its
        // timeline each have their own trigger below, and the diff shells out
        // to git for an answer no status change can have altered.
        invalidateSoon(queryKeys.task(taskId), true)
        invalidateSoon(queryKeys.tasks)
        invalidateSoon(queryKeys.attention)
      }
      if (event.type.startsWith('conversation.')) {
        invalidateSoon(queryKeys.conversations(taskId))
      }
      if (event.type.startsWith('decision.')) {
        invalidateSoon(queryKeys.decisions(taskId))
      }
      if (event.type.includes('artifact') || event.type === 'stage.completed') {
        invalidateSoon(queryKeys.artifacts(taskId))
      }
      // A finished stage is the only thing that can have left new commits.
      if (event.type === 'stage.completed') {
        invalidateSoon(queryKeys.diffFiles(taskId))
      }
    }

    return () => {
      controller.abort()
      if (flush) clearTimeout(flush)
    }
  }, [queryClient, taskId])

  return connection
}
