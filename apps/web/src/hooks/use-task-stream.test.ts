import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TimelineEvent } from '../lib/api-client.ts'
import type { EventStreamOptions } from '../lib/event-stream.ts'
import { setSecret } from '../lib/secret-store.ts'
import { mergeTimelineEvents, useTaskStream } from './use-task-stream.ts'

const consumeTaskEventStream = vi.hoisted(() => vi.fn())
vi.mock('../lib/event-stream.ts', () => ({ consumeTaskEventStream }))

const listEvents = vi.hoisted(() => vi.fn(async () => ({ events: [] as TimelineEvent[] })))
vi.mock('../lib/api-client.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api-client.ts')>()),
  listEvents,
}))

interface Invalidation {
  readonly queryKey: readonly unknown[]
  readonly exact?: boolean
}

function event(seq: number, type = 'conversation.response.completed'): TimelineEvent {
  return {
    seq,
    taskId: 'task-1',
    stageId: null,
    type,
    payload: { conversationId: 'conversation-1' },
    createdAt: `2026-08-16T10:00:0${seq}.000Z`,
  }
}

describe('task stream cache', () => {
  it('deduplicates a resumed conversation event and keeps sequence order', () => {
    const current = [event(1), event(3)]
    const withGapFilled = mergeTimelineEvents(current, event(2, 'conversation.action.proposed'))
    const replayed = mergeTimelineEvents(withGapFilled, event(3))

    expect(replayed.map((item) => item.seq)).toEqual([1, 2, 3])
  })
})

describe('useTaskStream', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    consumeTaskEventStream.mockReset()
    listEvents.mockReset().mockResolvedValue({ events: [] })
    setSecret('owner-secret')
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  async function listen(): Promise<{
    opened: EventStreamOptions
    onEvent: EventStreamOptions['onEvent']
    invalidations: () => Invalidation[]
  }> {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue(undefined)
    renderHook(() => useTaskStream('task-1'), {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client }, children),
    })
    // The stream now waits on the page it starts from, so opening it is a turn
    // of the microtask queue rather than part of the render.
    await vi.waitFor(() => {
      if (consumeTaskEventStream.mock.calls.length === 0) throw new Error('no stream yet')
    })
    const opened = consumeTaskEventStream.mock.calls.at(0)?.at(0) as EventStreamOptions

    return {
      opened,
      onEvent: opened.onEvent,
      invalidations: () => invalidate.mock.calls.map(([filters]) => filters as Invalidation),
    }
  }

  it('starts the stream where the page the screen reads ends, not at the task’s first event', async () => {
    listEvents.mockResolvedValue({ events: [event(401), event(600)] })

    const { opened } = await listen()

    expect(opened.initialCursor).toBe(600)
  })

  it('collapses a burst of events into one round of invalidations', async () => {
    const { onEvent, invalidations } = await listen()

    for (let seq = 1; seq <= 40; seq += 1) onEvent(event(seq))
    expect(invalidations()).toEqual([])

    vi.advanceTimersByTime(250)

    // The task's own row, the two indexes, and the conversations these touched.
    expect(invalidations()).toEqual([
      { queryKey: ['task', 'task-1'], exact: true },
      { queryKey: ['tasks'], exact: false },
      { queryKey: ['attention'], exact: false },
      { queryKey: ['task', 'task-1', 'conversations'], exact: false },
    ])
  })

  it('refetches the file diff when a stage finishes, not on every event', async () => {
    const { onEvent, invalidations } = await listen()
    const diff = ['task', 'task-1', 'diff', 'files']

    onEvent(event(1, 'stage.started'))
    vi.advanceTimersByTime(250)
    expect(invalidations().map((call) => call.queryKey)).not.toContainEqual(diff)

    onEvent(event(2, 'stage.completed'))
    vi.advanceTimersByTime(250)
    expect(invalidations().map((call) => call.queryKey)).toContainEqual(diff)
  })

  it('leaves every query alone through a stage-activity storm', async () => {
    const { onEvent, invalidations } = await listen()

    for (let seq = 1; seq <= 100; seq += 1) onEvent(event(seq, 'stage.activity'))
    vi.advanceTimersByTime(250)

    expect(invalidations()).toEqual([])
  })
})
