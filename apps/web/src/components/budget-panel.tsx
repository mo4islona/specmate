import { type BudgetKey, spendAgainstBudget } from '@specmate/core'
import type { TaskDetail } from '../lib/api-client.ts'
import { cn, MicroLabel } from '../ui/index.ts'
import { signalDot, signalText } from './tone.ts'

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

/**
 * Two meters, one line each. It is the smallest section on the screen and was
 * drawn like the largest — a heading, a label, a value, a bar and a sentence
 * per row. The sentence is now the `≈` the number wears: incomplete cost still
 * reads as incomplete (REQ-1505), it just no longer takes four lines to say so.
 */
export function BudgetPanel({
  budgets,
  spend,
  className,
}: {
  budgets: Budgets
  spend: Spend
  className?: string
}) {
  const rows = budgetRows(budgets, spend)

  return (
    <section aria-label="Budget" className={className}>
      <MicroLabel as="h2">Spend</MicroLabel>

      <dl className="mt-2.5 space-y-2">
        {rows.map((row) => {
          const near = row.ratio >= 0.8

          return (
            <div key={row.label}>
              <div className="flex items-baseline justify-between gap-2 font-mono text-[0.7rem]">
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd
                  className={near ? signalText('asking') : 'text-foreground'}
                  title={row.incomplete ? 'incomplete — some runs reported no cost' : undefined}
                >
                  {row.incomplete && (
                    <span className={signalText('asking')} aria-hidden="true">
                      ≈{' '}
                    </span>
                  )}
                  {row.display}
                  {row.incomplete && <span className="sr-only"> — incomplete</span>}
                </dd>
              </div>

              {/* A meter, not a table rule: the hairline under the number read
                  as an underline, which is what a spend row must not look like. */}
              <div className="mt-1.5 h-[3px] w-full overflow-hidden rounded-full bg-border/70">
                <div
                  className={cn(
                    'h-full rounded-full',
                    near ? signalDot('asking') : 'bg-foreground/25',
                  )}
                  style={{ width: `${Math.min(100, Math.round(row.ratio * 100))}%` }}
                />
              </div>
            </div>
          )
        })}
      </dl>
    </section>
  )
}
