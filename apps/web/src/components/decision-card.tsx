import { type BudgetKey, budgetFromRaiseOption } from '@specmate/core'
import { useEffect, useState } from 'react'
import type { DecisionItem } from '../lib/api-client.ts'
import { nodeLabel } from '../lib/task-thread.ts'
import { ArtifactMarkdown } from './artifact-markdown.tsx'

/** Mirrors the server's Budgets schema (packages/core/src/state.ts): whole minutes, any positive cost. */
function isValidRaiseValue(budget: BudgetKey, value: string): boolean {
  if (!value.trim()) return false
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return false

  return budget === 'max_wall_clock_minutes' ? Number.isInteger(numeric) : true
}

export interface DecisionCardProps {
  readonly decision: DecisionItem
  /** True when this open, blocking decision is the reason the task is parked. */
  readonly parkedOnThis: boolean
  /** `value` is only set for a budget-raise option, which needs one alongside it to mean anything. */
  readonly onAnswerOption: (optionId: string, value?: string) => void
  readonly onAnswerText: (text: string) => void
  readonly onDismiss: () => void
  readonly onDiscuss?: () => void
  readonly busy?: boolean
  readonly error?: string
}

/**
 * The accented surface REQ-912 requires for a raised decision: the question,
 * its offered options as direct actions, a free-text answer, and — while
 * open — an explicit statement that the task is stopped on it. Resolved,
 * it renders the outcome and stops offering controls; only the resolution
 * itself (never a chat message) ever changes that outcome.
 *
 * The offered options are the whole card when it is answerable in one click;
 * writing an answer instead, dismissing, and discussing are quieter, since
 * they are the rarer answers.
 */
export function DecisionCard({
  decision,
  parkedOnThis,
  onAnswerOption,
  onAnswerText,
  onDismiss,
  onDiscuss,
  busy = false,
  error,
}: DecisionCardProps) {
  const [text, setText] = useState('')
  const [raiseValues, setRaiseValues] = useState<Record<string, string>>({})
  const isOpen = decision.status === 'open'
  // A raise option only ever appears on the engine-raised budget-exhaustion
  // decision — its only other legal resolution is the `cancel` option, never
  // a plain dismissal or free-text answer (the engine refuses both).
  const isBudgetDecision = decision.options.some((option) => budgetFromRaiseOption(option.id))

  // Cleared only once the decision actually resolves — answerText is
  // fire-and-forget, so clearing on click would drop the owner's draft the
  // moment a submit fails (e.g. a 409 from a stale decision).
  useEffect(() => {
    if (!isOpen) {
      setText('')
      setRaiseValues({})
    }
  }, [isOpen])

  return (
    <li
      className={`border border-l-2 p-4 ${
        isOpen
          ? 'attention-pulse border-amber/40 border-l-amber bg-amber/[0.03]'
          : 'border-border border-l-border-bright'
      }`}
      data-decision-status={decision.status}
      data-decision-kind={decision.kind}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className={`micro-label ${isOpen ? 'text-amber' : 'text-muted'}`}>
          {decision.kind === 'escalation' ? 'Escalation' : 'Question'} ·{' '}
          {nodeLabel(decision.nodeKey)}
        </p>
        {isOpen && parkedOnThis ? (
          <p className="font-mono text-[0.68rem] font-bold text-danger" role="status">
            The task is stopped on this.
          </p>
        ) : (
          <span className="font-mono text-[0.62rem] text-muted">{decision.status}</span>
        )}
      </div>

      <div className="artifact-document mt-2 text-sm">
        <ArtifactMarkdown content={decision.promptMd} />
      </div>

      {isOpen && decision.options.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {decision.options.map((option) => {
            const raiseBudget = budgetFromRaiseOption(option.id)
            if (!raiseBudget) {
              return (
                <button
                  key={option.id}
                  type="button"
                  className="button-secondary min-h-9 py-1"
                  disabled={busy}
                  onClick={() => onAnswerOption(option.id)}
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
                  className="control min-h-9 w-28 py-1"
                  value={value}
                  onChange={(event) =>
                    setRaiseValues((prev) => ({ ...prev, [option.id]: event.currentTarget.value }))
                  }
                  placeholder="New value"
                  aria-label={`New value for ${option.label}`}
                />
                <button
                  type="button"
                  className="button-secondary min-h-9 py-1"
                  disabled={busy || !isValidRaiseValue(raiseBudget, value)}
                  onClick={() => onAnswerOption(option.id, value.trim())}
                >
                  {option.label}
                </button>
              </div>
            )
          })}
        </div>
      )}

      {isOpen && !isBudgetDecision && (
        <details className="mt-3" open={decision.options.length === 0}>
          <summary className="cursor-pointer font-mono text-[0.66rem] uppercase tracking-widest text-muted hover:text-text">
            Answer in your own words…
          </summary>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <textarea
              className="control min-h-16 w-full min-w-0 resize-y"
              value={text}
              onChange={(event) => setText(event.currentTarget.value)}
              placeholder="Free-text answer…"
              aria-label={`Answer for ${decision.key}`}
            />
            <button
              type="button"
              className="button-primary shrink-0 sm:w-32"
              disabled={busy || !text.trim()}
              onClick={() => onAnswerText(text.trim())}
            >
              Answer
            </button>
          </div>
        </details>
      )}

      {isOpen && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {!isBudgetDecision && (
            <button type="button" className="button-ghost" disabled={busy} onClick={onDismiss}>
              Dismiss
            </button>
          )}
          {onDiscuss && (
            <button type="button" className="button-ghost" disabled={busy} onClick={onDiscuss}>
              Discuss
            </button>
          )}
        </div>
      )}

      {!isOpen && (
        <p className="mt-3 border-t border-border pt-2 text-sm leading-6 text-muted">
          <span className="micro-label mr-2 text-muted">
            {decision.status === 'dismissed' ? 'Dismissed' : 'Answered'} by{' '}
            {decision.answeredBy ?? 'unknown'}
          </span>
          {decision.answerMd}
        </p>
      )}

      {error && <p className="field-error">{error}</p>}
    </li>
  )
}
