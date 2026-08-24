import { type BudgetKey, budgetFromRaiseOption } from '@specmate/core'
import { useState } from 'react'
import type { DecisionItem } from '../lib/api-client.ts'

/** Mirrors the server's Budgets schema (packages/core/src/state.ts): whole minutes, any positive cost. */
function isValidRaiseValue(budget: BudgetKey, value: string): boolean {
  if (!value.trim()) return false
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return false

  return budget === 'max_wall_clock_minutes' ? Number.isInteger(numeric) : true
}

interface DecisionOptionsProps {
  readonly options: DecisionItem['options']
  readonly busy: boolean
  /** `value` is only set for a budget-raise option, which needs one alongside it to mean anything. */
  readonly onAnswer: (optionId: string, value?: string) => void
}

/**
 * A question's offered answers, as direct actions (REQ-912). They sit above the
 * console's input because answering in one click is the common case and typing
 * is the fallback — not the other way round.
 */
export function DecisionOptions({ options, busy, onAnswer }: DecisionOptionsProps) {
  const [raiseValues, setRaiseValues] = useState<Record<string, string>>({})

  if (options.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2 px-4 pt-3">
      {options.map((option) => {
        const raiseBudget = budgetFromRaiseOption(option.id)
        if (!raiseBudget) {
          return (
            <button
              key={option.id}
              type="button"
              className="chip"
              disabled={busy}
              onClick={() => onAnswer(option.id)}
            >
              {option.label}
            </button>
          )
        }

        const value = raiseValues[option.id] ?? ''
        const isMinutes = raiseBudget === 'max_wall_clock_minutes'

        return (
          <div key={option.id} className="flex shrink-0 items-center gap-2">
            <input
              type="number"
              min={isMinutes ? '1' : '0.01'}
              step={isMinutes ? '1' : 'any'}
              className="control min-h-8 w-28 py-1"
              value={value}
              onChange={(event) =>
                setRaiseValues((prev) => ({ ...prev, [option.id]: event.currentTarget.value }))
              }
              placeholder="New value"
              aria-label={`New value for ${option.label}`}
            />
            <button
              type="button"
              className="chip"
              disabled={busy || !isValidRaiseValue(raiseBudget, value)}
              onClick={() => onAnswer(option.id, value.trim())}
            >
              {option.label}
            </button>
          </div>
        )
      })}
    </div>
  )
}
