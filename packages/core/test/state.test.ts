import { describe, expect, test } from 'vitest'
import { isHumanGate, isTerminal, TASK_STATES, TERMINAL_STATES } from '../src/state.ts'

// Transition legality is graph-derived and lives in pipeline.test.ts; what
// stays here is the type-independent vocabulary the engine builds on.
describe('task state vocabulary', () => {
  test('the three human gates are exactly the gate states', () => {
    expect(TASK_STATES.filter(isHumanGate)).toEqual([
      'human_kickoff_gate',
      'human_spec_gate',
      'human_final_gate',
    ])
  })

  test('terminal states are the closed end of the lifecycle', () => {
    expect(TERMINAL_STATES).toEqual(['archived', 'cancelled', 'failed'])
    for (const state of TERMINAL_STATES) expect(isTerminal(state)).toBe(true)
    expect(isTerminal('implement')).toBe(false)
  })
})
