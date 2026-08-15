import { describe, expect, test } from 'bun:test'
import {
  canTransition,
  isHumanGate,
  isTerminal,
  TASK_STATES,
  type TaskState,
  TRANSITIONS,
} from '../src/state.ts'

describe('task state machine', () => {
  test('every state has a transition entry', () => {
    for (const state of TASK_STATES) {
      expect(TRANSITIONS[state]).toBeDefined()
    }
  })

  test('every transition target is a known state', () => {
    const known = new Set<string>(TASK_STATES)
    for (const [from, targets] of Object.entries(TRANSITIONS)) {
      for (const to of targets) {
        expect(known.has(to), `${from} → ${to}`).toBe(true)
      }
    }
  })

  test('terminal states have no outgoing transitions', () => {
    for (const state of TASK_STATES.filter(isTerminal)) {
      if (state === 'failed') continue // failed is recoverable by design
      expect(TRANSITIONS[state]).toHaveLength(0)
    }
  })

  test('happy path walks from draft to archived', () => {
    const path: TaskState[] = [
      'draft',
      'planning',
      'kickoff_brief',
      'human_kickoff_gate',
      'research',
      'spec_review',
      'human_spec_gate',
      'implement',
      'verify',
      'code_review',
      'summarize',
      'human_final_gate',
      'publish',
      'archived',
    ]
    for (let i = 0; i < path.length - 1; i++) {
      const from = path[i]
      const to = path[i + 1]
      if (!from || !to) throw new Error('path is malformed')
      expect(canTransition(from, to), `${from} → ${to}`).toBe(true)
    }
  })

  test('review loops go back, not forward', () => {
    expect(canTransition('spec_review', 'research')).toBe(true)
    expect(canTransition('code_review', 'implement')).toBe(true)
    expect(canTransition('code_review', 'publish')).toBe(false)
  })

  test('archived tasks cannot be cancelled or paused', () => {
    expect(canTransition('archived', 'cancelled')).toBe(false)
    expect(canTransition('archived', 'paused')).toBe(false)
    expect(canTransition('implement', 'paused')).toBe(true)
  })

  test('the three human gates are exactly the gate states', () => {
    expect(TASK_STATES.filter(isHumanGate)).toEqual([
      'human_kickoff_gate',
      'human_spec_gate',
      'human_final_gate',
    ])
  })
})
