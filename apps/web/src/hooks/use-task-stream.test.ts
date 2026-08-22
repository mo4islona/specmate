import { describe, expect, test } from 'vitest'
import type { TimelineEvent } from '../lib/api-client.ts'
import { mergeTimelineEvents } from './use-task-stream.ts'

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
  test('deduplicates a resumed conversation event and keeps sequence order', () => {
    const current = [event(1), event(3)]
    const withGapFilled = mergeTimelineEvents(current, event(2, 'conversation.action.proposed'))
    const replayed = mergeTimelineEvents(withGapFilled, event(3))

    expect(replayed.map((item) => item.seq)).toEqual([1, 2, 3])
  })
})
