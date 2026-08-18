import type { TaskDetail } from '../lib/api-client.ts'

type Budgets = TaskDetail['task']['budgets']
type Spend = TaskDetail['spend']

interface BudgetRow {
  readonly label: string
  readonly display: string
  readonly ratio: number
  readonly incomplete: boolean
}

/** REQ-1505: incomplete cost is shown as incomplete, never silently as a bare number. */
function budgetRows(budgets: Budgets, spend: Spend): BudgetRow[] {
  return [
    {
      label: 'Cost',
      display: `$${spend.costUsd.toFixed(2)} of $${budgets.max_cost_usd.toFixed(2)}`,
      ratio: budgets.max_cost_usd > 0 ? spend.costUsd / budgets.max_cost_usd : 0,
      incomplete: !spend.costComplete,
    },
    {
      label: 'Agent-minutes',
      display: `${spend.agentMinutes.toFixed(1)} of ${budgets.max_wall_clock_minutes} min`,
      ratio:
        budgets.max_wall_clock_minutes > 0
          ? spend.agentMinutes / budgets.max_wall_clock_minutes
          : 0,
      incomplete: false,
    },
  ]
}

export function BudgetPanel({ budgets, spend }: { budgets: Budgets; spend: Spend }) {
  const rows = budgetRows(budgets, spend)

  return (
    <section className="panel p-4 sm:p-5" aria-label="Budget">
      <p className="micro-label text-phosphor">Spend</p>
      <h2 className="mt-2 text-lg font-semibold">Budget</h2>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        {rows.map((row) => {
          const near = row.ratio >= 0.8

          return (
            <div
              key={row.label}
              className={`border p-3 ${near ? 'border-amber/45' : 'border-border'}`}
            >
              <dt className="font-mono text-xs text-muted">{row.label}</dt>
              <dd className="mt-1 font-mono text-sm text-text">{row.display}</dd>
              {row.incomplete && (
                <p className="mt-1 font-mono text-[0.68rem] text-amber">
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
