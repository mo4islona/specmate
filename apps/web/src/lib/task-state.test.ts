import { describe, expect, test } from 'vitest'
import type { DecisionItem, TaskDetail } from './api-client.ts'
import { taskStateSentence } from './task-state.ts'

type Stage = TaskDetail['stages'][number]
type Task = TaskDetail['task']

const NOW = new Date('2026-08-16T10:05:00.000Z').getTime()
const SPEND = { costUsd: 2.5, agentMinutes: 7, costComplete: true } as TaskDetail['spend']

function task(overrides: Partial<Task> = {}): Task {
  return {
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
    startedAt: '2026-08-16T10:00:00.000Z',
    finishedAt: '2026-08-16T10:04:00.000Z',
    ...overrides,
  } as Stage
}

function decision(overrides: Partial<DecisionItem> = {}): DecisionItem {
  return { id: 'd1', nodeKey: 'kickoff_brief', status: 'open', ...overrides } as DecisionItem
}

describe('taskStateSentence (REQ-920)', () => {
  test('a running node reads as what it is doing and for how long', () => {
    const sentence = taskStateSentence({
      task: task(),
      stages: [stage({ status: 'running', finishedAt: null })],
      decisions: [],
      spend: SPEND,
      now: NOW,
    })

    expect(sentence.tone).toBe('running')
    expect(sentence.headline).toBe('Implement')
    expect(sentence.detail).toBe('running for 5m')
  })

  test('open questions name where they came from', () => {
    const sentence = taskStateSentence({
      task: task({ status: 'blocked' }),
      stages: [],
      decisions: [decision(), decision({ id: 'd2' })],
      spend: SPEND,
      now: NOW,
    })

    expect(sentence.tone).toBe('attention')
    expect(sentence.headline).toBe('Waiting on you')
    expect(sentence.detail).toBe('2 questions from kickoff brief')
  })

  test('a gate is the owner’s call, named', () => {
    const sentence = taskStateSentence({
      task: task({ status: 'human_spec_gate' }),
      stages: [],
      decisions: [],
      spend: SPEND,
      now: NOW,
    })

    expect(sentence.headline).toBe('Waiting on you')
    expect(sentence.detail).toBe('spec gate is yours to call')
  })

  test('a stopped task says which node stopped and how often', () => {
    const sentence = taskStateSentence({
      task: task({ status: 'failed' }),
      stages: [stage({ status: 'failed', attempt: 2 })],
      decisions: [],
      spend: SPEND,
      now: NOW,
    })

    expect(sentence.tone).toBe('stopped')
    expect(sentence.detail).toBe('Implement failed 3 times')
  })

  test('a spent budget is a pause with a reason, not a failure', () => {
    const sentence = taskStateSentence({
      task: task({ status: 'paused' }),
      stages: [],
      decisions: [],
      spend: { ...SPEND, costUsd: 20 },
      now: NOW,
    })

    expect(sentence.headline).toBe('Paused')
    expect(sentence.detail).toBe('the budget is spent')
  })
})
