import { describe, expect, it, test } from 'vitest'
import type { DecisionItem, TaskDetail } from './api-client.ts'
import { consoleDestination, parkedStop } from './task-console.ts'
import type { PipelineNodeView } from './task-pipeline.ts'

type Stage = TaskDetail['stages'][number]
type Task = TaskDetail['task']

const SPEND = { costUsd: 2.5, agentMinutes: 7, costComplete: true } as TaskDetail['spend']

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    status: 'implement',
    budgets: { max_cost_usd: 20, max_wall_clock_minutes: 180 },
    ...overrides,
  } as Task
}

function stage(overrides: Partial<Stage> = {}): Stage {
  return {
    id: 'stage-1',
    nodeKey: 'implement',
    status: 'succeeded',
    attempt: 0,
    ...overrides,
  } as Stage
}

function node(overrides: Partial<PipelineNodeView> = {}): PipelineNodeView {
  return {
    key: 'research',
    kind: 'stage',
    label: 'Research',
    role: 'researcher',
    binding: null,
    state: 'pending',
    reason: null,
    current: false,
    runs: [],
    latest: null,
    ...overrides,
  } as PipelineNodeView
}

function decision(overrides: Partial<DecisionItem> = {}): DecisionItem {
  return {
    id: 'decision-1',
    nodeKey: 'kickoff_brief',
    status: 'open',
    blocking: true,
    conversationId: null,
    ...overrides,
  } as DecisionItem
}

const BASE = {
  task: task(),
  stages: [] as Stage[],
  nodes: [] as PipelineNodeView[],
  openDecisions: [] as DecisionItem[],
  gateKey: null,
  interruptedStage: null,
  spend: SPEND,
  discussingDecision: null,
}

describe('consoleDestination (REQ-921)', () => {
  test('a running node is the destination, and the field alone names it', () => {
    const running = stage({ status: 'running', nodeKey: 'implement' })
    const destination = consoleDestination({ ...BASE, stages: [running] })

    expect(destination.kind).toBe('running-node')
    expect(destination.nodeKey).toBe('implement')
    expect(destination.placeholder).toBe('Ask Implement something, or steer it…')
    // Nothing above the field: the step it goes to is the step being read.
    expect(destination.head).toBeNull()
    expect(destination.unavailable).toBeNull()
  })

  test('an open question makes the input the answer', () => {
    const destination = consoleDestination({
      ...BASE,
      stages: [stage({ status: 'running' })],
      openDecisions: [decision(), decision({ id: 'd2' }), decision({ id: 'd3' })],
    })

    expect(destination.kind).toBe('question')
    expect(destination.label).toBe('Your answer')
    expect(destination.submit).toBe('Answer')
  })

  test('a gate makes the input the gate comment', () => {
    const destination = consoleDestination({
      ...BASE,
      task: task({ status: 'human_spec_gate' }),
      gateKey: 'human_spec_gate',
    })

    expect(destination.kind).toBe('gate')
    expect(destination.submit).toBe('Approve')
    expect(destination.head).toEqual({ to: 'Spec gate', note: 'your call' })
  })

  test('a gate with a redirect edge counts what is left of it', () => {
    const destination = consoleDestination({
      ...BASE,
      task: task({ status: 'human_spec_gate' }),
      gateKey: 'human_spec_gate',
      redirect: { used: 1, limit: 3 },
    })

    expect(destination.head?.note).toBe('2 of 3 redirects left')
  })

  test('an interrupted stage makes the input guidance for the restart', () => {
    const destination = consoleDestination({
      ...BASE,
      task: task({ status: 'paused' }),
      interruptedStage: stage({ status: 'interrupted', nodeKey: 'implement' }),
    })

    expect(destination.kind).toBe('restart')
    expect(destination.submit).toBe('Restart')
    expect(destination.head?.to).toBe('Implement')
    // REQ-914: the loss is stated where it is about to happen, not in a panel.
    expect(destination.head?.note).toContain('uncommitted work is already gone')
  })

  test('nothing running still has a destination: the node that runs next', () => {
    const destination = consoleDestination({
      ...BASE,
      nodes: [
        node({ key: 'planning', state: 'done', runs: [stage()] }),
        node({ key: 'research', label: 'Research' }),
      ],
    })

    expect(destination.kind).toBe('next-node')
    expect(destination.nodeKey).toBe('research')
    expect(destination.placeholder).toBe('Anything Research should know…')
  })

  test('a spent budget has no destination and says what would restore one (AC-965)', () => {
    const destination = consoleDestination({
      ...BASE,
      task: task({ status: 'paused' }),
      spend: { ...SPEND, costUsd: 20 },
      stages: [stage({ status: 'running' })],
    })

    expect(destination.kind).toBe('nowhere')
    expect(destination.unavailable).toBe('The budget is spent.')
    expect(destination.head).toEqual({ to: 'nowhere', note: '$20.00 of $20.00 spent' })
  })

  test('reading an older step makes the text a note pinned to it (AC-912)', () => {
    const destination = consoleDestination({
      ...BASE,
      stages: [stage({ status: 'running', nodeKey: 'implement' })],
      readingStep: { nodeKey: 'research', label: 'Research' },
    })

    expect(destination.kind).toBe('step-note')
    expect(destination.nodeKey).toBe('research')
    // Honest about its reach: a pinned comment is commentary, not guidance.
    expect(destination.head?.note).toContain('no run reads it')
  })

  test('a question outranks the step the owner went back to read', () => {
    const destination = consoleDestination({
      ...BASE,
      openDecisions: [decision()],
      readingStep: { nodeKey: 'research', label: 'Research' },
    })

    expect(destination.kind).toBe('question')
  })

  test('a finished task takes no message', () => {
    const destination = consoleDestination({ ...BASE, task: task({ status: 'archived' }) })

    expect(destination.kind).toBe('nowhere')
    expect(destination.unavailable).toBe('The task is finished.')
  })

  test('a discussion the owner opened outranks the question it was opened from', () => {
    const asked = decision({ conversationId: 'conversation-1' })
    const destination = consoleDestination({
      ...BASE,
      openDecisions: [asked],
      discussingDecision: asked,
    })

    expect(destination.kind).toBe('discussion')
    expect(destination.head?.note).toContain('costs a model call')
  })
})

describe('the console does not restate the step it is standing in', () => {
  test('a stop at the step being read keeps only what the header does not say', () => {
    const interrupted = stage({ status: 'interrupted', nodeKey: 'specify', attempt: 1 })
    const destination = consoleDestination({
      ...BASE,
      task: task({ status: 'paused' }),
      interruptedStage: interrupted,
      stepKey: 'specify',
    })

    expect(destination.head?.to).toBeNull()
    expect(destination.head?.note).toBe(
      'stopped after 2 attempts · uncommitted work is already gone',
    )
  })

  test('a stop at a step the owner is not reading still names which one', () => {
    const interrupted = stage({ status: 'interrupted', nodeKey: 'specify', attempt: 1 })
    const destination = consoleDestination({
      ...BASE,
      task: task({ status: 'paused' }),
      interruptedStage: interrupted,
      stepKey: 'planning',
    })

    expect(destination.head?.to).toBe('Specify')
  })

  test('a destination with no node of its own is always named', () => {
    const destination = consoleDestination({
      ...BASE,
      task: task({ status: 'archived' }),
      stepKey: 'specify',
    })

    expect(destination.head?.to).toBe('nowhere')
  })
})

describe('parkedStop', () => {
  it('a task paused on a node is standing on that stop', () => {
    const stopped = stage({ id: 'stage-2', status: 'interrupted', nodeKey: 'implement' })

    expect(
      parkedStop(task({ status: 'paused', resumeStatus: 'implement' }), [stage(), stopped]),
    ).toBe(stopped)
  })

  it('a restarted task is no longer stopped, though the interrupted row remains', () => {
    const stopped = stage({ id: 'stage-2', status: 'interrupted', nodeKey: 'implement' })
    const rerun = stage({ id: 'stage-3', status: 'running', nodeKey: 'implement', attempt: 1 })

    expect(
      parkedStop(task({ status: 'implement', resumeStatus: null }), [stopped, rerun]),
    ).toBeNull()
  })

  it('a stop at another node is not the one the task is parked on', () => {
    const stopped = stage({ id: 'stage-2', status: 'interrupted', nodeKey: 'specify' })

    expect(parkedStop(task({ status: 'paused', resumeStatus: 'implement' }), [stopped])).toBeNull()
  })

  it('the newest attempt is the stop, whatever order the API returned them in', () => {
    const first = stage({
      id: 'stage-1',
      status: 'interrupted',
      startedAt: '2026-08-24T10:00:00.000Z',
    })
    const second = stage({
      id: 'stage-2',
      status: 'interrupted',
      attempt: 1,
      startedAt: '2026-08-24T12:00:00.000Z',
    })

    expect(parkedStop(task({ status: 'paused', resumeStatus: 'implement' }), [second, first])).toBe(
      second,
    )
    expect(parkedStop(task({ status: 'paused', resumeStatus: 'implement' }), [first, second])).toBe(
      second,
    )
  })
})
