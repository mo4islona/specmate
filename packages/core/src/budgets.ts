import type { Budgets } from './state-schemas.ts'

export const BUDGET_KEYS = ['max_cost_usd', 'max_wall_clock_minutes'] as const
export type BudgetKey = (typeof BUDGET_KEYS)[number]

/**
 * One agent run's contribution to a task's spend, already normalized from
 * whatever recorded it — a stage row's `cost` plus its `startedAt`/`finishedAt`,
 * or one entry of a conversation response's `telemetry` array. Absent is null,
 * never zero, so an unreported cost cannot be mistaken for a free run.
 */
export interface SpendAttempt {
  readonly costUsd: number | null
  readonly durationMs: number | null
}

export interface Spend {
  readonly costUsd: number
  /** False once any counted attempt's cost is unknown — the sum is a floor, not a fact. */
  readonly costComplete: boolean
  readonly agentMinutes: number
}

/**
 * REQ-1501: spend is what ran, not what elapsed. Every attempt counts once,
 * whatever produced it; an attempt with no recorded duration (should not
 * happen for one already finished, but defensive) contributes nothing rather
 * than poisoning the sum.
 */
export function computeSpend(attempts: readonly SpendAttempt[]): Spend {
  let costUsd = 0
  let costComplete = true
  let durationMs = 0

  for (const attempt of attempts) {
    if (attempt.costUsd === null) costComplete = false
    else costUsd += attempt.costUsd

    if (attempt.durationMs !== null) durationMs += attempt.durationMs
  }

  return { costUsd, costComplete, agentMinutes: durationMs / 60_000 }
}

export interface BudgetExhaustion {
  readonly exhausted: boolean
  /** Which budget(s) spend has reached — never empty when `exhausted` is true. */
  readonly reached: readonly BudgetKey[]
}

/**
 * Tolerance for the float drift that summing many attempts' costs/durations
 * accumulates — without it, a task whose true spend lands exactly on its cap
 * can compute as fractionally under it and never pause.
 */
export const BUDGET_EPSILON = 1e-9

/**
 * REQ-1502: incomplete cost is never treated as reaching the cost budget on
 * its own — it can only ever underreport, which is exactly why the
 * agent-minutes budget exists as the provider-independent backstop.
 */
export function budgetExhaustion(spend: Spend, budgets: Budgets): BudgetExhaustion {
  const reached: BudgetKey[] = []
  if (spend.agentMinutes >= budgets.max_wall_clock_minutes - BUDGET_EPSILON) {
    reached.push('max_wall_clock_minutes')
  }
  if (spend.costUsd >= budgets.max_cost_usd - BUDGET_EPSILON) reached.push('max_cost_usd')

  return { exhausted: reached.length > 0, reached }
}

export function spendAgainstBudget(spend: Spend, budget: BudgetKey): number {
  return budget === 'max_cost_usd' ? spend.costUsd : spend.agentMinutes
}
