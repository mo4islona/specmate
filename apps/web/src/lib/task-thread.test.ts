import { describe, expect, test } from 'vitest'
import type { ConversationMessage, DecisionItem, TaskDetail, TimelineEvent } from './api-client.ts'
import {
  buildThread,
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

describe('buildThread', () => {
  const research = stage({ id: 'stage-research', nodeKey: 'research' })

  test('a stage-scoped event lands in that stage’s chapter', () => {
    const chapters = buildThread({
      events: [
        timelineEvent({
          seq: 1,
          type: 'stage.completed',
          stageId: research.id,
          createdAt: '2026-08-16T10:05:00.000Z',
        }),
      ],
      stages: [research],
      messages: [],
      entryState: 'research',
    })

    expect(chapters).toHaveLength(1)
    expect(chapters[0]?.kind).toBe('stage')
    expect(chapters[0]?.nodeKey).toBe('research')
    expect(chapters[0]?.entries).toHaveLength(1)
  })

  test('a comment posted mid-run joins the run it is about instead of splitting the thread', () => {
    const chapters = buildThread({
      events: [
        timelineEvent({
          seq: 1,
          type: 'feedback.comment',
          createdAt: '2026-08-16T10:02:00.000Z',
          payload: { comment: 'Check the migration too' },
        }),
        timelineEvent({
          seq: 2,
          type: 'stage.completed',
          stageId: research.id,
          createdAt: '2026-08-16T10:05:00.000Z',
        }),
      ],
      stages: [research],
      messages: [conversationMessage()],
      entryState: 'research',
    })

    expect(chapters).toHaveLength(1)
    expect(chapters[0]?.entries.map((entry) => entry.kind)).toEqual(['event', 'message', 'event'])
  })

  test('gate work becomes the gate’s own chapter, and re-entering a node opens a new one', () => {
    const second = stage({
      id: 'stage-research-2',
      nodeKey: 'research',
      attempt: 1,
      startedAt: '2026-08-16T10:07:00.000Z',
      finishedAt: null,
      status: 'running',
    })
    const chapters = buildThread({
      events: [
        timelineEvent({
          seq: 1,
          type: 'stage.completed',
          stageId: research.id,
          createdAt: '2026-08-16T10:05:00.000Z',
        }),
        timelineEvent({
          seq: 2,
          type: 'task.transitioned',
          createdAt: '2026-08-16T10:05:00.000Z',
          payload: { from: 'research', to: 'human_spec_gate' },
        }),
        timelineEvent({
          seq: 3,
          type: 'gate.reworked',
          createdAt: '2026-08-16T10:06:00.000Z',
          payload: { gate: 'human_spec_gate', to: 'research', comment: 'Missed the API' },
        }),
        timelineEvent({
          seq: 4,
          type: 'task.transitioned',
          createdAt: '2026-08-16T10:06:30.000Z',
          payload: { from: 'human_spec_gate', to: 'research' },
        }),
        timelineEvent({
          seq: 5,
          type: 'stage.activity',
          stageId: second.id,
          createdAt: '2026-08-16T10:08:00.000Z',
          payload: { tool: 'Read', target: 'src/api.ts' },
        }),
      ],
      stages: [research, second],
      messages: [],
      entryState: 'research',
    })

    expect(chapters.map((chapter) => `${chapter.kind}:${chapter.nodeKey}`)).toEqual([
      'stage:research',
      'gate:human_spec_gate',
      'stage:research',
    ])
    expect(chapters[1]?.entries).toHaveLength(1)
    expect(chapters[2]?.stage?.attempt).toBe(1)
  })

  test('transitions and dispatches leave no line of their own — the chapter they open says it', () => {
    const chapters = buildThread({
      events: [
        timelineEvent({
          seq: 1,
          type: 'stage.dispatched',
          stageId: research.id,
          createdAt: '2026-08-16T10:00:00.000Z',
        }),
        timelineEvent({
          seq: 2,
          type: 'task.transitioned',
          createdAt: '2026-08-16T10:05:00.000Z',
          payload: { from: 'research', to: 'spec_review' },
        }),
      ],
      stages: [research],
      messages: [],
      entryState: 'research',
    })

    expect(chapters.flatMap((chapter) => chapter.entries)).toHaveLength(0)
  })

  test('parking opens the gate’s chapter instead of trailing the stage that ran into it', () => {
    const chapters = buildThread({
      events: [
        timelineEvent({
          seq: 1,
          type: 'stage.completed',
          stageId: research.id,
          createdAt: '2026-08-16T10:05:00.000Z',
        }),
        timelineEvent({
          seq: 2,
          type: 'task.parked',
          createdAt: '2026-08-16T10:05:00.000Z',
          payload: { from: 'research', to: 'human_spec_gate' },
        }),
      ],
      stages: [research],
      messages: [],
      entryState: 'research',
    })

    expect(chapters.map((chapter) => chapter.nodeKey)).toEqual(['research', 'human_spec_gate'])
    expect(chapters[1]?.entries).toHaveLength(1)
  })

  test('an entry stamped exactly at a stage’s finish belongs to that stage', () => {
    const chapters = buildThread({
      events: [],
      stages: [research],
      messages: [conversationMessage({ createdAt: '2026-08-16T10:05:00.000Z' })],
      entryState: 'research',
    })

    expect(chapters).toHaveLength(1)
    expect(chapters[0]?.entries).toHaveLength(1)
  })

  test('an event that lands on a node before its stage row starts joins the run it precedes', () => {
    const chapters = buildThread({
      events: [
        timelineEvent({
          seq: 1,
          type: 'task.created',
          createdAt: '2026-08-16T09:59:00.000Z',
          payload: { title: 'Harness: launch work' },
        }),
        timelineEvent({
          seq: 2,
          type: 'stage.completed',
          stageId: research.id,
          createdAt: '2026-08-16T10:05:00.000Z',
        }),
      ],
      stages: [research],
      messages: [],
      entryState: 'research',
    })

    expect(chapters).toHaveLength(1)
    expect(chapters[0]?.kind).toBe('stage')
    expect(chapters[0]?.entries.map((entry) => entry.id)).toEqual(['event-1', 'event-2'])
  })

  test('a stage whose events fell outside the event window still gets its chapter', () => {
    const chapters = buildThread({
      events: [],
      stages: [research],
      messages: [],
      entryState: 'research',
    })

    expect(chapters.map((chapter) => chapter.nodeKey)).toEqual(['research'])
  })
})
