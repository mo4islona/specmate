import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ConversationMessage, DecisionItem, TimelineEvent } from '../lib/api-client.ts'
import {
  ConversationMessageItem,
  countGateRedirects,
  EVENT_TITLES,
  eventDetail,
} from './task-screen.tsx'

function message(overrides: Partial<ConversationMessage> = {}): ConversationMessage {
  return {
    id: 'message-1',
    conversationId: 'conversation-1',
    sequence: 2,
    replyToMessageId: 'message-0',
    role: 'assistant',
    contentMd: '',
    status: 'queued',
    stageId: null,
    taskState: 'spec_review',
    contextCommit: null,
    provider: null,
    failureReason: null,
    telemetry: [],
    createdAt: '2026-08-16T10:00:00.000Z',
    updatedAt: '2026-08-16T10:00:00.000Z',
    ...overrides,
  }
}

describe('conversation message item', () => {
  test('renders a distinct pending response with its task stage', () => {
    const rendered = renderToStaticMarkup(<ConversationMessageItem message={message()} />)

    expect(rendered).toContain('data-timeline-kind="conversation-message"')
    expect(rendered).toContain('attention-pulse')
    expect(rendered).toContain('spec review')
    expect(rendered).toContain('Waiting for a response slot')
  })

  test('renders the answer as markdown while leaving raw HTML inert', () => {
    const rendered = renderToStaticMarkup(
      <ConversationMessageItem
        message={message({
          status: 'completed',
          contentMd: '**Bounded.** <script>alert(1)</script>',
        })}
      />,
    )

    expect(rendered).toContain('<strong>Bounded.</strong>')
    expect(rendered).not.toContain('<script>')
    expect(rendered).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  test('renders the recorded failure in the answer position', () => {
    const rendered = renderToStaticMarkup(
      <ConversationMessageItem
        message={message({ status: 'failed', failureReason: 'provider unavailable' })}
      />,
    )

    expect(rendered).toContain('Response failed: provider unavailable')
  })
})

function timelineEvent(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    seq: 1,
    taskId: 'task-1',
    stageId: null,
    type: 'decision.raised',
    payload: {},
    createdAt: '2026-08-16T10:00:00.000Z',
    ...overrides,
  } as TimelineEvent
}

function decisionItem(overrides: Partial<DecisionItem> = {}): DecisionItem {
  return {
    id: 'decision-1',
    taskId: 'task-1',
    stageId: null,
    nodeKey: 'research',
    key: 'scope',
    kind: 'question',
    promptMd: 'What does this cover?',
    options: [],
    blocking: true,
    answerMd: null,
    answeredBy: null,
    status: 'open',
    createdAt: '2026-08-16T10:00:00.000Z',
    answeredAt: null,
    conversationId: null,
    ...overrides,
  } as DecisionItem
}

describe('decision timeline events', () => {
  test('decision.raised shows the actual question, not the raw event type', () => {
    const decision = decisionItem({ promptMd: 'Worth a follow-up task?' })
    const event = timelineEvent({
      type: 'decision.raised',
      payload: { decisionId: decision.id, nodeKey: 'research', key: 'style-nit', blocking: false },
    })

    expect(EVENT_TITLES[event.type]).toBe('Decision raised')
    expect(eventDetail(event, new Map([[decision.id, decision]]))).toBe('Worth a follow-up task?')
  })

  test('decision.answered shows the actor and the recorded answer', () => {
    const decision = decisionItem({ status: 'answered', answerMd: 'The whole repository.' })
    const event = timelineEvent({
      type: 'decision.answered',
      payload: { decisionId: decision.id, nodeKey: 'research', key: 'scope', actor: 'evgeny' },
    })

    expect(EVENT_TITLES[event.type]).toBe('Decision answered')
    expect(eventDetail(event, new Map([[decision.id, decision]]))).toBe(
      'Answered by evgeny: The whole repository.',
    )
  })

  test('decision.dismissed with no matching decision row still reads as dismissed, not the raw payload keys', () => {
    const event = timelineEvent({
      type: 'decision.dismissed',
      payload: {
        decisionId: 'missing-decision',
        nodeKey: 'research',
        key: 'scope',
        actor: 'evgeny',
      },
    })

    expect(EVENT_TITLES[event.type]).toBe('Decision dismissed')
    expect(eventDetail(event, new Map())).toBe('Dismissed by evgeny.')
  })

  test('other event types keep falling back through the existing payload chain', () => {
    const event = timelineEvent({
      type: 'gate.redirected',
      payload: { comment: 'Needs another pass' },
    })

    expect(eventDetail(event, new Map())).toBe('Needs another pass')
  })
})

describe('countGateRedirects', () => {
  test('counts redirects at the named gate only', () => {
    const events = [
      timelineEvent({ type: 'gate.redirected', payload: { gate: 'human_kickoff_gate' } }),
      timelineEvent({ type: 'gate.redirected', payload: { gate: 'human_kickoff_gate' } }),
      timelineEvent({ type: 'gate.redirected', payload: { gate: 'human_spec_gate' } }),
      timelineEvent({ type: 'gate.approved', payload: { gate: 'human_kickoff_gate' } }),
    ]

    expect(countGateRedirects(events, 'human_kickoff_gate')).toBe(2)
    expect(countGateRedirects(events, 'human_spec_gate')).toBe(1)
  })

  test('a task with no redirects yet counts zero', () => {
    expect(countGateRedirects([], 'human_kickoff_gate')).toBe(0)
  })
})
