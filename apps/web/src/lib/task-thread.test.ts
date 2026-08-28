import { describe, expect, it, test } from 'vitest'
import type { ConversationMessage, DecisionItem, TaskDetail, TimelineEvent } from './api-client.ts'
import {
  assignSteps,
  buildStepFeed,
  countGateRedirects,
  EVENT_TITLES,
  eventDetail,
  eventTitle,
  formatDuration,
  formatTokens,
  liveActivity,
  nodeLabel,
  stageActivityLabel,
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

  test('decision.answered carries the words alone — who and what are the entry’s own', () => {
    const decision = decisionItem({ status: 'answered', answerMd: 'The whole repository.' })
    const event = timelineEvent({
      type: 'decision.answered',
      payload: { decisionId: decision.id, nodeKey: 'research', key: 'scope', actor: 'evgeny' },
    })

    expect(EVENT_TITLES[event.type]).toBe('Decision answered')
    expect(eventDetail(event, new Map([[decision.id, decision]]))).toBe('The whole repository.')
  })

  test('decision.dismissed with no matching decision row says nothing rather than raw payload keys', () => {
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
    // The verb on the entry reads "dismissed"; a body would only repeat it.
    expect(eventDetail(event, new Map())).toBeNull()
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

  it.each([
    ['scope_violation', 'The run changed files its role may not touch.'],
    ['backend_error', 'The run could not be started.'],
  ])('reads the failure %s as the sentence its table entry carries', (reason, sentence) => {
    const event = timelineEvent({
      type: 'stage.failed',
      payload: { reason, detail: 'openspec/changes/other/proposal.md' },
    })

    expect(eventDetail(event, new Map())).toBe(`${sentence} — openspec/changes/other/proposal.md`)
  })

  it('leaves a reason the failure table never had as the words it spells', () => {
    const event = timelineEvent({ type: 'task.failed', payload: { reason: 'verification_failed' } })

    expect(eventDetail(event, new Map())).toBe('verification failed')
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

describe('assignSteps (REQ-919)', () => {
  test('an event with no node of its own belongs to the step the task stood on', () => {
    const events = [
      timelineEvent({ seq: 1, type: 'task.created' }),
      timelineEvent({ seq: 2, type: 'task.transitioned', payload: { to: 'research' } }),
      timelineEvent({ seq: 3, type: 'feedback.comment', payload: { comment: 'Careful there.' } }),
    ]
    const steps = assignSteps({ events, stages: [], firstNodeKey: 'planning' })

    expect(steps.get(1)).toBe('planning')
    // The transition opens the chapter it names rather than closing the last one.
    expect(steps.get(2)).toBe('research')
    expect(steps.get(3)).toBe('research')
  })

  test('an approval is written at the gate it passed, and moves the task on', () => {
    const events = [
      timelineEvent({
        seq: 1,
        type: 'gate.approved',
        payload: { gate: 'human_spec_gate', to: 'implement' },
      }),
      timelineEvent({ seq: 2, type: 'feedback.comment', payload: { comment: 'Go.' } }),
    ]
    const steps = assignSteps({ events, stages: [], firstNodeKey: 'planning' })

    expect(steps.get(1)).toBe('human_spec_gate')
    expect(steps.get(2)).toBe('implement')
  })

  test('a stage event belongs to its stage’s node whatever the task moved to since', () => {
    const run = stage({ id: 'stage-1', nodeKey: 'research' })
    const events = [
      timelineEvent({ seq: 1, type: 'task.transitioned', payload: { to: 'implement' } }),
      timelineEvent({ seq: 2, type: 'stage.completed', stageId: run.id }),
    ]
    const steps = assignSteps({ events, stages: [run], firstNodeKey: 'planning' })

    expect(steps.get(2)).toBe('research')
  })
})

describe('buildStepFeed (REQ-919, REQ-915)', () => {
  const emptyDecisions = new Map<string, DecisionItem>()
  const base = { messages: [], decisionsById: emptyDecisions, firstNodeKey: 'planning' }

  test('a step records what it changed, in the past tense, and not what it read', () => {
    const run = stage({ id: 'stage-1', nodeKey: 'research', status: 'succeeded' })
    const feed = buildStepFeed({
      ...base,
      events: [
        timelineEvent({ seq: 1, type: 'stage.dispatched', stageId: run.id }),
        timelineEvent({
          seq: 2,
          type: 'stage.activity',
          stageId: run.id,
          payload: { tool: 'Read', target: 'src/foo.ts' },
        }),
        timelineEvent({
          seq: 3,
          type: 'stage.activity',
          stageId: run.id,
          payload: { tool: 'Edit', target: 'src/foo.ts' },
        }),
        timelineEvent({ seq: 4, type: 'stage.completed', stageId: run.id }),
      ],
      stages: [run],
      nodeKey: 'research',
    })

    expect(feed.map((entry) => entry.kind)).toEqual(['line', 'line', 'line'])
    expect(feed.map((entry) => (entry.kind === 'line' ? entry.action : null))).toEqual([
      'Stage started',
      'Edited',
      'Stage accepted',
    ])
  })

  test('an unrecognized tool keeps its line: we cannot claim it changed nothing', () => {
    const run = stage({ id: 'stage-1', nodeKey: 'research', status: 'succeeded' })
    const feed = buildStepFeed({
      ...base,
      events: [
        timelineEvent({
          seq: 1,
          type: 'stage.activity',
          stageId: run.id,
          payload: { tool: 'CustomTool', target: 'thing' },
        }),
      ],
      stages: [run],
      nodeKey: 'research',
    })

    expect(feed).toHaveLength(1)
  })

  test('a run that only read leaves the step with nothing but its boundaries', () => {
    const run = stage({ id: 'stage-1', nodeKey: 'research', status: 'interrupted' })
    const feed = buildStepFeed({
      ...base,
      events: [
        timelineEvent({ seq: 1, type: 'stage.dispatched', stageId: run.id }),
        ...['Read', 'Grep', 'Glob', 'WebFetch', 'BashOutput', 'TodoWrite', 'Task'].map(
          (tool, index) =>
            timelineEvent({
              seq: index + 2,
              type: 'stage.activity',
              stageId: run.id,
              payload: { tool, target: 'src/foo.ts' },
            }),
        ),
        timelineEvent({ seq: 9, type: 'stage.interrupted', stageId: run.id }),
      ],
      stages: [run],
      nodeKey: 'research',
    })

    expect(feed.map((entry) => (entry.kind === 'line' ? entry.action : null))).toEqual([
      'Stage started',
      'Run stopped',
    ])
  })

  it('a shell call that only looked leaves nothing behind either', () => {
    const run = stage({ id: 'stage-1', nodeKey: 'research', status: 'succeeded' })
    const shell = (seq: number, command: string) =>
      timelineEvent({
        seq,
        type: 'stage.activity',
        stageId: run.id,
        payload: { tool: 'Bash', target: command },
      })
    const feed = buildStepFeed({
      ...base,
      events: [
        shell(1, `sed -n '1,140p' src/helpers/mount-chart.tsx`),
        shell(2, 'tail -40 /tmp/task.output'),
        shell(3, 'git status --short'),
        shell(4, 'bun run test'),
      ],
      stages: [run],
      nodeKey: 'research',
    })

    expect(feed.map((entry) => (entry.kind === 'line' ? entry.target : null))).toEqual([
      'bun run test',
    ])
  })

  test('the workspace root every target is prefixed with is not read forty times', () => {
    const run = stage({ id: 'stage-1', nodeKey: 'research', status: 'succeeded' })
    const feed = buildStepFeed({
      ...base,
      events: [
        timelineEvent({
          seq: 1,
          type: 'stage.activity',
          stageId: run.id,
          payload: {
            tool: 'Write',
            target: '/var/lib/specmate/workspaces/tasks/https-github-com-acme-x-01a0/src/pie.ts',
          },
        }),
      ],
      stages: [run],
      nodeKey: 'research',
    })

    expect(feed[0]?.kind === 'line' && feed[0].target).toBe('src/pie.ts')
  })

  test('reading another step is reading another chapter', () => {
    const run = stage({ id: 'stage-1', nodeKey: 'research' })
    const feed = buildStepFeed({
      ...base,
      events: [timelineEvent({ seq: 1, type: 'stage.dispatched', stageId: run.id })],
      stages: [run],
      nodeKey: 'implement',
    })

    expect(feed).toEqual([])
  })

  test('what a person said in that step is a turn, in the order it happened', () => {
    const answered = decisionItem({
      id: 'decision-1',
      nodeKey: 'planning',
      status: 'answered',
      answerMd: 'The whole repository.',
    })
    const feed = buildStepFeed({
      ...base,
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
      nodeKey: 'planning',
    })

    expect(feed.map((entry) => (entry.kind === 'turn' ? entry.verb : entry.action))).toEqual([
      'launched this task',
      'asked',
      'answered',
      'commented',
    ])
  })

  test('an open question is not in the thread; it lives above the input (AC-956)', () => {
    const open = decisionItem({ id: 'decision-1', nodeKey: 'planning', status: 'open' })
    const feed = buildStepFeed({
      ...base,
      events: [
        timelineEvent({
          seq: 1,
          type: 'decision.raised',
          payload: { decisionId: open.id, nodeKey: 'planning' },
        }),
      ],
      stages: [],
      decisionsById: new Map([[open.id, open]]),
      nodeKey: 'planning',
    })

    expect(feed).toEqual([])
  })

  test('a resolved question carries its decision so the whole exchange can be opened (AC-958)', () => {
    const answered = decisionItem({
      id: 'd1',
      nodeKey: 'planning',
      status: 'answered',
      answerMd: 'One field.',
    })
    const [entry] = buildStepFeed({
      ...base,
      events: [
        timelineEvent({
          seq: 1,
          type: 'decision.answered',
          payload: { decisionId: answered.id, nodeKey: 'planning' },
        }),
      ],
      stages: [],
      decisionsById: new Map([[answered.id, answered]]),
      nodeKey: 'planning',
    })

    expect(entry?.kind).toBe('turn')
    expect(entry?.kind === 'turn' && entry.decisionId).toBe('d1')
    expect(entry?.kind === 'turn' && entry.body).toContain('One field.')
  })

  test('the newest change of a running run is live; everything older is record', () => {
    const run = stage({ id: 'stage-1', nodeKey: 'research', status: 'running', finishedAt: null })
    const feed = buildStepFeed({
      ...base,
      events: [
        timelineEvent({
          seq: 1,
          type: 'stage.activity',
          stageId: run.id,
          payload: { tool: 'Write' },
        }),
        timelineEvent({
          seq: 2,
          type: 'stage.activity',
          stageId: run.id,
          payload: { tool: 'Edit' },
        }),
      ],
      stages: [run],
      nodeKey: 'research',
    })

    expect(feed.map((entry) => entry.kind === 'line' && entry.live)).toEqual([false, true])
  })

  test('once the run ends, its last action stops claiming to be live (AC-941)', () => {
    const run = stage({ id: 'stage-1', nodeKey: 'research', status: 'succeeded' })
    const feed = buildStepFeed({
      ...base,
      events: [
        timelineEvent({
          seq: 1,
          type: 'stage.activity',
          stageId: run.id,
          payload: { tool: 'Edit' },
        }),
      ],
      stages: [run],
      nodeKey: 'research',
    })

    expect(feed.map((entry) => entry.kind === 'line' && entry.live)).toEqual([false])
  })

  test('a failure is a line of its own step, whether or not a later attempt recovered', () => {
    const failed = stage({ id: 'stage-1', nodeKey: 'implement', attempt: 0, status: 'failed' })
    const succeeded = stage({ id: 'stage-2', nodeKey: 'implement', attempt: 1 })
    const feed = buildStepFeed({
      ...base,
      events: [
        timelineEvent({
          seq: 1,
          type: 'stage.failed',
          stageId: failed.id,
          payload: { reason: 'verification_failed' },
        }),
      ],
      stages: [failed, succeeded],
      nodeKey: 'implement',
    })

    expect(feed[0]?.kind === 'line' && feed[0].tone).toBe('trouble')
    expect(feed[0]?.kind === 'line' && feed[0].target).toBe('verification failed')
  })

  it('gives a failed run its sentence on the line, not its identifier', () => {
    const failed = stage({ id: 'stage-1', nodeKey: 'implement', attempt: 0, status: 'failed' })
    const feed = buildStepFeed({
      ...base,
      events: [
        timelineEvent({
          seq: 1,
          type: 'stage.failed',
          stageId: failed.id,
          payload: { reason: 'backend_error' },
        }),
      ],
      stages: [failed],
      nodeKey: 'implement',
    })

    expect(feed[0]?.kind === 'line' && feed[0].target).toBe('The run could not be started.')
  })

  test('a message belongs to the step the task stood on when it was written', () => {
    const messages = [
      conversationMessage({ id: 'm1', role: 'owner', createdAt: '2026-08-16T10:03:00.000Z' }),
      conversationMessage({ id: 'm2', role: 'assistant', createdAt: '2026-08-16T10:03:30.000Z' }),
    ]
    const events = [
      timelineEvent({ seq: 1, type: 'task.created', createdAt: '2026-08-16T10:00:00.000Z' }),
      timelineEvent({
        seq: 2,
        type: 'task.transitioned',
        payload: { to: 'research' },
        createdAt: '2026-08-16T10:02:00.000Z',
      }),
    ]

    const planning = buildStepFeed({ ...base, events, messages, stages: [], nodeKey: 'planning' })
    const research = buildStepFeed({ ...base, events, messages, stages: [], nodeKey: 'research' })

    expect(planning.filter((entry) => entry.kind === 'turn')).toHaveLength(1)
    expect(
      research
        .filter((entry) => entry.kind === 'turn')
        .map((entry) => (entry.kind === 'turn' ? entry.author : null)),
    ).toEqual(['owner', 'guide'])
  })
})

describe('liveActivity (REQ-915)', () => {
  test('the newest action of the running run, present tense and without its workspace root', () => {
    const run = stage({ id: 'stage-1', nodeKey: 'research', status: 'running', finishedAt: null })
    const events = [
      timelineEvent({
        seq: 1,
        type: 'stage.activity',
        stageId: run.id,
        payload: { tool: 'Read', target: '/srv/workspaces/tasks/acme-x-01a0/src/old.ts' },
      }),
      timelineEvent({
        seq: 2,
        type: 'stage.activity',
        stageId: run.id,
        payload: { tool: 'Grep', target: 'resolveFade' },
      }),
    ]

    expect(liveActivity({ events, stages: [run], nodeKey: 'research' })).toEqual({
      action: 'Searching',
      target: 'resolveFade',
      stageId: 'stage-1',
    })
  })

  test('a run that has started but reported nothing still says it is working', () => {
    const run = stage({ id: 'stage-1', nodeKey: 'research', status: 'running', finishedAt: null })

    expect(liveActivity({ events: [], stages: [run], nodeKey: 'research' })?.action).toBe('Working')
  })

  test('no run under way at this step is no line at all', () => {
    const done = stage({ id: 'stage-1', nodeKey: 'research', status: 'succeeded' })
    const elsewhere = stage({
      id: 'stage-2',
      nodeKey: 'implement',
      status: 'running',
      finishedAt: null,
    })

    expect(liveActivity({ events: [], stages: [done, elsewhere], nodeKey: 'research' })).toBeNull()
  })
})
