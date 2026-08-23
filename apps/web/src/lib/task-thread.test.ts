import { describe, expect, test } from 'vitest'
import type { ConversationMessage, DecisionItem, TaskDetail, TimelineEvent } from './api-client.ts'
import {
  buildFeed,
  countGateRedirects,
  EVENT_TITLES,
  eventDetail,
  eventTitle,
  formatDuration,
  formatTokens,
  nodeLabel,
  stageActivityLabel,
  visibleTimelineEvents,
} from './task-thread.ts'

type Stage = TaskDetail['stages'][number]

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

function stage(overrides: Partial<Stage> = {}): Stage {
  return {
    id: 'stage-1',
    taskId: 'task-1',
    graphId: 'graph-1',
    nodeKey: 'research',
    role: 'researcher',
    provider: 'claude-code',
    status: 'succeeded',
    attempt: 0,
    skillSha: null,
    result: null,
    acceptedCommit: null,
    startedAt: '2026-08-16T10:00:00.000Z',
    finishedAt: '2026-08-16T10:05:00.000Z',
    interruptionCleanupStatus: null,
    interruptionFailure: null,
    createdAt: '2026-08-16T10:00:00.000Z',
    updatedAt: '2026-08-16T10:05:00.000Z',
    telemetry: null,
    ...overrides,
  } as Stage
}

function conversationMessage(overrides: Partial<ConversationMessage> = {}): ConversationMessage {
  return {
    id: 'message-1',
    conversationId: 'conversation-1',
    sequence: 1,
    replyToMessageId: null,
    role: 'owner',
    contentMd: 'Anything blocking?',
    status: 'completed',
    stageId: null,
    taskState: 'research',
    contextCommit: null,
    provider: null,
    failureReason: null,
    telemetry: [],
    createdAt: '2026-08-16T10:02:00.000Z',
    updatedAt: '2026-08-16T10:02:00.000Z',
    ...overrides,
  } as ConversationMessage
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

  test('an event carrying nothing readable gets no invented detail line', () => {
    expect(eventDetail(timelineEvent({ type: 'task.resumed', payload: {} }), new Map())).toBeNull()
  })
})

describe('event titles', () => {
  test('a transition is titled by where it went, not by its event type', () => {
    const event = timelineEvent({ type: 'gate.approved', payload: { to: 'implement' } })

    expect(eventTitle(event)).toBe('Approved → implement')
  })

  test('an event with no target keeps its plain title', () => {
    expect(eventTitle(timelineEvent({ type: 'task.published', payload: {} }))).toBe(
      'Pull request published',
    )
  })
})

describe('stage activity rendering (REQ-915)', () => {
  test('a recognized tool use reads as a verb and its target (AC-940)', () => {
    const event = timelineEvent({
      type: 'stage.activity',
      payload: { tool: 'Edit', target: 'src/foo.ts', attempt: 0 },
    })

    expect(stageActivityLabel(event)).toBe('Editing src/foo.ts')
  })

  test('an unrecognized tool falls back to its own name', () => {
    const event = timelineEvent({
      type: 'stage.activity',
      payload: { tool: 'CustomTool', target: 'thing', attempt: 0 },
    })

    expect(stageActivityLabel(event)).toBe('CustomTool thing')
  })

  test('no target reads as the verb alone', () => {
    const event = timelineEvent({
      type: 'stage.activity',
      payload: { tool: 'TodoWrite', target: '', attempt: 0 },
    })

    expect(stageActivityLabel(event)).toBe('Updating plan')
  })

  test('activity for a still-running stage stays visible (AC-940)', () => {
    const event = timelineEvent({ type: 'stage.activity', stageId: 'stage-1' })

    expect(visibleTimelineEvents([event], [{ id: 'stage-1', status: 'running' }])).toEqual([event])
  })

  test('activity is demoted once its stage is no longer running (AC-941)', () => {
    const event = timelineEvent({ type: 'stage.activity', stageId: 'stage-1' })

    for (const status of ['succeeded', 'failed', 'interrupted', 'waiting_human']) {
      expect(visibleTimelineEvents([event], [{ id: 'stage-1', status }])).toEqual([])
    }
  })

  test('every other event type is unaffected by stage status', () => {
    const event = timelineEvent({ type: 'stage.completed', stageId: 'stage-1' })

    expect(visibleTimelineEvents([event], [{ id: 'stage-1', status: 'succeeded' }])).toEqual([
      event,
    ])
  })

  test('a running stage with no activity events yet is not treated as stalled (AC-942)', () => {
    // No `stage.activity` events at all — the demotion filter has nothing to
    // drop, and nothing here marks the absence as an error or a stall.
    const events = [timelineEvent({ type: 'stage.dispatched', stageId: 'stage-1' })]

    expect(visibleTimelineEvents(events, [{ id: 'stage-1', status: 'running' }])).toEqual(events)
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

describe('labels and numbers', () => {
  test('a gate node key reads as a name, not as an enum value', () => {
    expect(nodeLabel('human_kickoff_gate')).toBe('Kickoff gate')
    expect(nodeLabel('spec_review')).toBe('Spec review')
  })

  test('durations round to something a person reads at a glance', () => {
    expect(formatDuration(42_000)).toBe('42s')
    expect(formatDuration(3 * 60_000)).toBe('3m')
    expect(formatDuration(3 * 60_000 + 12_000)).toBe('3m 12s')
    expect(formatDuration(3_900_000)).toBe('1h 05m')
  })

  test('token counts are abbreviated past a thousand', () => {
    expect(formatTokens(412)).toBe('412')
    expect(formatTokens(41_200)).toBe('41.2k')
    expect(formatTokens(2_400_000)).toBe('2.40M')
  })
})

describe('buildFeed (REQ-919)', () => {
  const emptyDecisions = new Map<string, DecisionItem>()

  test('a stage that started, worked and was accepted leaves no line behind', () => {
    const run = stage({ id: 'stage-1', nodeKey: 'research' })
    const feed = buildFeed({
      events: [
        timelineEvent({ seq: 1, type: 'stage.dispatched', stageId: run.id }),
        timelineEvent({
          seq: 2,
          type: 'stage.activity',
          stageId: run.id,
          payload: { tool: 'Read' },
        }),
        timelineEvent({ seq: 3, type: 'stage.completed', stageId: run.id }),
        timelineEvent({ seq: 4, type: 'task.transitioned', payload: { to: 'spec_review' } }),
      ],
      messages: [],
      stages: [run],
      decisionsById: emptyDecisions,
    })

    expect(feed).toEqual([])
  })

  test('what a person said or was asked earns a line, in the order it happened', () => {
    const answered = decisionItem({
      id: 'decision-1',
      status: 'answered',
      answerMd: 'The whole repository.',
    })
    const feed = buildFeed({
      events: [
        timelineEvent({ seq: 1, type: 'task.created', createdAt: '2026-08-16T10:00:00.000Z' }),
        timelineEvent({
          seq: 2,
          type: 'decision.answered',
          payload: { decisionId: answered.id, actor: 'evgeny' },
          createdAt: '2026-08-16T10:04:00.000Z',
        }),
        timelineEvent({
          seq: 3,
          type: 'feedback.comment',
          payload: { comment: 'Keep the migration reversible.' },
          createdAt: '2026-08-16T10:06:00.000Z',
        }),
      ],
      messages: [conversationMessage({ createdAt: '2026-08-16T10:02:00.000Z' })],
      stages: [],
      decisionsById: new Map([[answered.id, answered]]),
    })

    expect(feed.map((entry) => entry.verb)).toEqual([
      'launched this task',
      'asked',
      'answered',
      'commented',
    ])
  })

  test('an open question is not in the feed; it lives above the input (AC-956)', () => {
    const open = decisionItem({ id: 'decision-1', status: 'open' })
    const feed = buildFeed({
      events: [
        timelineEvent({ seq: 1, type: 'decision.raised', payload: { decisionId: open.id } }),
      ],
      messages: [],
      stages: [],
      decisionsById: new Map([[open.id, open]]),
    })

    expect(feed).toEqual([])
  })

  test('a resolved question carries its decision so the whole exchange can be opened (AC-958)', () => {
    const answered = decisionItem({ id: 'd1', status: 'answered', answerMd: 'One field.' })
    const [entry] = buildFeed({
      events: [
        timelineEvent({ seq: 1, type: 'decision.answered', payload: { decisionId: answered.id } }),
      ],
      messages: [],
      stages: [],
      decisionsById: new Map([[answered.id, answered]]),
    })

    expect(entry?.decisionId).toBe('d1')
    expect(entry?.body).toContain('One field.')
  })

  test('a failure that was retried into an acceptance is the machine’s business', () => {
    const failed = stage({ id: 'stage-1', nodeKey: 'implement', attempt: 0, status: 'failed' })
    const succeeded = stage({
      id: 'stage-2',
      nodeKey: 'implement',
      attempt: 1,
      status: 'succeeded',
    })
    const feed = buildFeed({
      events: [timelineEvent({ seq: 1, type: 'stage.failed', stageId: failed.id })],
      messages: [],
      stages: [failed, succeeded],
      decisionsById: emptyDecisions,
    })

    expect(feed).toEqual([])
  })

  test('a failure that is still the last word at its node is addressed to the owner', () => {
    const failed = stage({ id: 'stage-1', nodeKey: 'implement', attempt: 2, status: 'failed' })
    const [entry] = buildFeed({
      events: [timelineEvent({ seq: 1, type: 'stage.failed', stageId: failed.id })],
      messages: [],
      stages: [failed],
      decisionsById: emptyDecisions,
    })

    expect(entry?.label).toBe('Implement')
    expect(entry?.verb).toBe('failed')
    expect(entry?.nodeKey).toBe('implement')
  })

  test('the guide answers as itself, the owner as themselves', () => {
    const feed = buildFeed({
      events: [],
      messages: [
        conversationMessage({ id: 'm1', role: 'owner', createdAt: '2026-08-16T10:00:00.000Z' }),
        conversationMessage({ id: 'm2', role: 'assistant', createdAt: '2026-08-16T10:00:30.000Z' }),
      ],
      stages: [],
      decisionsById: emptyDecisions,
    })

    expect(feed.map((entry) => entry.author)).toEqual(['owner', 'guide'])
  })
})
