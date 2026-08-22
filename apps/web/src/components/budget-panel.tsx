import { type BudgetKey, spendAgainstBudget } from '@specmate/core'
import type { TaskDetail } from '../lib/api-client.ts'

type Budgets = TaskDetail['task']['budgets']
type Spend = TaskDetail['spend']

interface BudgetRow {
  readonly label: string
  readonly display: string
  readonly ratio: number
  readonly incomplete: boolean
}

function ratioAgainst(spend: Spend, budgets: Budgets, key: BudgetKey): number {
  const cap = budgets[key]

  return cap > 0 ? spendAgainstBudget(spend, key) / cap : 0
}

/** REQ-1505: incomplete cost is shown as incomplete, never silently as a bare number. */
function budgetRows(budgets: Budgets, spend: Spend): BudgetRow[] {
  return [
    {
      label: 'Cost',
      display: `$${spend.costUsd.toFixed(2)} of $${budgets.max_cost_usd.toFixed(2)}`,
      ratio: ratioAgainst(spend, budgets, 'max_cost_usd'),
      incomplete: !spend.costComplete,
    },
    {
      label: 'Agent-minutes',
      display: `${spend.agentMinutes.toFixed(1)} of ${budgets.max_wall_clock_minutes} min`,
      ratio: ratioAgainst(spend, budgets, 'max_wall_clock_minutes'),
      incomplete: false,
    },
  ]
}

export function BudgetPanel({ budgets, spend }: { budgets: Budgets; spend: Spend }) {
  const rows = budgetRows(budgets, spend)

  return (
    <section aria-label="Budget">
      <h2 className="micro-label text-muted">Spend</h2>
      <dl className="mt-3 space-y-3">
        {rows.map((row) => {
          const near = row.ratio >= 0.8

          return (
            <div key={row.label}>
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-[0.72rem] text-muted">{row.label}</dt>
                <dd className={`font-mono text-[0.7rem] ${near ? 'text-amber' : 'text-text'}`}>
                  {row.display}
                </dd>
              </div>
              <div className="mt-1.5 h-0.5 w-full bg-border">
                <div
                  className={`h-0.5 ${near ? 'bg-amber' : 'bg-phosphor/60'}`}
                  style={{ width: `${Math.min(100, Math.round(row.ratio * 100))}%` }}
                />
              </div>
              {row.incomplete && (
                <p className="mt-1.5 text-[0.62rem] leading-4 text-amber">
                  incomplete — some runs reported no cost
                </p>
              )}
            </div>
          )
        })}
      </dl>
    </section>
  )
}
