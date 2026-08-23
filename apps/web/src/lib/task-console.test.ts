import { describe, expect, test } from 'vitest'
import type { DecisionItem, TaskDetail } from './api-client.ts'
import { consoleDestination } from './task-console.ts'
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
    stoppedReason: null,
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
  test('a running node is the destination, and the line says next run', () => {
    const running = stage({ status: 'running', nodeKey: 'implement' })
    const destination = consoleDestination({ ...BASE, stages: [running] })

    expect(destination.kind).toBe('running-node')
    expect(destination.nodeKey).toBe('implement')
    expect(destination.line).toBe('Picked up by Implement on its next run')
    expect(destination.unavailable).toBeNull()
  })

  test('an open question makes the input the answer, and counts the rest', () => {
    const destination = consoleDestination({
      ...BASE,
      stages: [stage({ status: 'running' })],
      openDecisions: [decision(), decision({ id: 'd2' }), decision({ id: 'd3' })],
    })

    expect(destination.kind).toBe('question')
    expect(destination.label).toBe('Your answer')
    expect(destination.line).toBe('Unblocks Kickoff brief · 2 questions after this one')
  })

  test('a gate makes the input the gate comment', () => {
    const destination = consoleDestination({
      ...BASE,
      task: task({ status: 'human_spec_gate' }),
      gateKey: 'human_spec_gate',
    })

    expect(destination.kind).toBe('gate')
    expect(destination.line).toBe('Spec gate · your call')
  })

  test('an interrupted stage makes the input guidance for the restart', () => {
    const destination = consoleDestination({
      ...BASE,
      task: task({ status: 'paused' }),
      interruptedStage: stage({ status: 'interrupted', nodeKey: 'implement' }),
    })

    expect(destination.kind).toBe('restart')
    expect(destination.line).toBe('Carried into the restart of implement')
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
    expect(destination.line).toBe('Picked up by Research when it starts · nothing runs now')
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
    expect(destination.line).toBe('Nothing will run until the cap moves.')
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
    expect(destination.line).toContain('costs a model call')
  })
})
