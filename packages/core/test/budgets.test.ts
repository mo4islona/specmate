import { describe, expect, test } from 'bun:test'
import {
  budgetExhaustion,
  computeSpend,
  type Spend,
  type SpendAttempt,
  spendAgainstBudget,
} from '../src/budgets.ts'
import { DEFAULT_BUDGETS } from '../src/state.ts'

function attempt(overrides: Partial<SpendAttempt> = {}): SpendAttempt {
  return { costUsd: 1, durationMs: 60_000, ...overrides }
}

describe('computeSpend', () => {
  test('a completed stage attempt and a completed conversation attempt both count', () => {
    const stageAttempt = attempt({ costUsd: 0.5, durationMs: 30_000 })
    const conversationAttempt = attempt({ costUsd: 0.25, durationMs: 15_000 })

    const spend = computeSpend([stageAttempt, conversationAttempt])

    expect(spend).toEqual({ costUsd: 0.75, costComplete: true, agentMinutes: 0.75 })
  })

  test('a retried attempt counts alongside the one it retried, not instead of it', () => {
    const failed = attempt({ costUsd: 0.1, durationMs: 10_000 })
    const retried = attempt({ costUsd: 0.2, durationMs: 20_000 })

    expect(computeSpend([failed, retried]).agentMinutes).toBeCloseTo(0.5)
    expect(computeSpend([failed, retried]).costUsd).toBeCloseTo(0.3)
  })

  test('an owner-interrupted attempt still counts its recorded duration and cost', () => {
    const interrupted = attempt({ costUsd: 0.3, durationMs: 45_000 })

    expect(computeSpend([interrupted])).toEqual({
      costUsd: 0.3,
      costComplete: true,
      agentMinutes: 0.75,
    })
  })

  test('all-reported attempts leave cost complete', () => {
    const spend = computeSpend([attempt({ costUsd: 1 }), attempt({ costUsd: 2 })])
    expect(spend.costComplete).toBe(true)
    expect(spend.costUsd).toBe(3)
  })

  test('none-reported attempts sum to zero cost but stay marked incomplete, never as zero spend', () => {
    const spend = computeSpend([
      attempt({ costUsd: null, durationMs: 60_000 }),
      attempt({ costUsd: null, durationMs: 60_000 }),
    ])
    expect(spend.costUsd).toBe(0)
    expect(spend.costComplete).toBe(false)
    expect(spend.agentMinutes).toBe(2)
  })

  test('partly-reported attempts sum only the known cost and mark the total incomplete', () => {
    const spend = computeSpend([
      attempt({ costUsd: 1 }),
      attempt({ costUsd: null }),
      attempt({ costUsd: 2 }),
    ])
    expect(spend.costUsd).toBe(3)
    expect(spend.costComplete).toBe(false)
  })

  test('an unfinished attempt with no recorded duration does not poison the agent-minutes sum', () => {
    const spend = computeSpend([
      attempt({ durationMs: 60_000 }),
      attempt({ durationMs: null }),
      attempt({ durationMs: 120_000 }),
    ])
    expect(spend.agentMinutes).toBe(3)
  })

  test('no attempts is zero spend and complete — nothing has run yet, nothing is missing', () => {
    expect(computeSpend([])).toEqual({ costUsd: 0, costComplete: true, agentMinutes: 0 })
  })
})

describe('budgetExhaustion', () => {
  const budgets = DEFAULT_BUDGETS

  test('under both budgets is not exhausted', () => {
    const spend: Spend = { costUsd: 1, costComplete: true, agentMinutes: 1 }
    expect(budgetExhaustion(spend, budgets)).toEqual({ exhausted: false, reached: [] })
  })

  test('the cost budget reached independently names only cost', () => {
    const spend: Spend = { costUsd: budgets.max_cost_usd, costComplete: true, agentMinutes: 1 }
    expect(budgetExhaustion(spend, budgets)).toEqual({
      exhausted: true,
      reached: ['max_cost_usd'],
    })
  })

  test('the agent-minutes budget reached independently names only agent-minutes', () => {
    const spend: Spend = {
      costUsd: 1,
      costComplete: true,
      agentMinutes: budgets.max_wall_clock_minutes,
    }
    expect(budgetExhaustion(spend, budgets)).toEqual({
      exhausted: true,
      reached: ['max_wall_clock_minutes'],
    })
  })

  test('both budgets reached at once names both', () => {
    const spend: Spend = {
      costUsd: budgets.max_cost_usd,
      costComplete: true,
      agentMinutes: budgets.max_wall_clock_minutes,
    }
    expect(budgetExhaustion(spend, budgets)).toEqual({
      exhausted: true,
      reached: ['max_wall_clock_minutes', 'max_cost_usd'],
    })
  })

  test('incomplete cost that sums under the cap never reaches it — an underestimate, not a false trigger', () => {
    const spend: Spend = { costUsd: 0, costComplete: false, agentMinutes: 1 }
    expect(budgetExhaustion(spend, budgets).reached).not.toContain('max_cost_usd')
  })

  test('the provider-independent cap still bites when cost is entirely absent', () => {
    const spend: Spend = {
      costUsd: 0,
      costComplete: false,
      agentMinutes: budgets.max_wall_clock_minutes,
    }
    expect(budgetExhaustion(spend, budgets)).toEqual({
      exhausted: true,
      reached: ['max_wall_clock_minutes'],
    })
  })
})

describe('spendAgainstBudget', () => {
  test('reads the field matching the requested budget', () => {
    const spend: Spend = { costUsd: 4.5, costComplete: true, agentMinutes: 12 }
    expect(spendAgainstBudget(spend, 'max_cost_usd')).toBe(4.5)
    expect(spendAgainstBudget(spend, 'max_wall_clock_minutes')).toBe(12)
  })
})
