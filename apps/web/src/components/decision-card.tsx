import { useState } from 'react'
import type { DecisionItem } from '../lib/api-client.ts'
import { ArtifactMarkdown } from './artifact-markdown.tsx'

export interface DecisionCardProps {
  readonly decision: DecisionItem
  /** True when this open, blocking decision is the reason the task is parked. */
  readonly parkedOnThis: boolean
  readonly onAnswerOption: (optionId: string) => void
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
  const isOpen = decision.status === 'open'

  return (
    <li
      className={`panel border-l-2 p-4 sm:p-5 ${isOpen ? 'border-l-amber attention-pulse' : 'border-l-border'}`}
      data-decision-status={decision.status}
      data-decision-kind={decision.kind}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="micro-label text-amber">
            {decision.kind === 'escalation' ? 'Escalation' : 'Decision'} · {decision.nodeKey}
          </p>
          {isOpen && parkedOnThis && (
            <p className="mt-1 font-mono text-xs font-bold text-danger" role="status">
              The task is stopped on this.
            </p>
          )}
        </div>
        <span className="shrink-0 font-mono text-xs text-muted">{decision.status}</span>
      </div>

      <div className="artifact-document mt-3 text-sm">
        <ArtifactMarkdown content={decision.promptMd} />
      </div>

      {isOpen && decision.options.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {decision.options.map((option) => (
            <button
              key={option.id}
              type="button"
              className="button-secondary"
              disabled={busy}
              onClick={() => onAnswerOption(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}

      {isOpen && (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <textarea
            className="control min-h-16 w-full min-w-0 resize-y"
            value={text}
            onChange={(event) => setText(event.currentTarget.value)}
            placeholder="Free-text answer…"
            aria-label={`Answer for ${decision.key}`}
          />
          <div className="flex shrink-0 flex-col gap-2 sm:w-40">
            <button
              type="button"
              className="button-primary"
              disabled={busy || !text.trim()}
              onClick={() => {
                onAnswerText(text.trim())
                setText('')
              }}
            >
              Answer
            </button>
            <button type="button" className="button-secondary" disabled={busy} onClick={onDismiss}>
              Dismiss
            </button>
            {onDiscuss && (
              <button
                type="button"
                className="button-secondary"
                disabled={busy}
                onClick={onDiscuss}
              >
                Discuss
              </button>
            )}
          </div>
        </div>
      )}

      {!isOpen && (
        <div className="mt-4 border-t border-border pt-3 text-sm">
          <p className="micro-label text-muted">
            {decision.status === 'dismissed' ? 'Dismissed' : 'Answered'} by{' '}
            {decision.answeredBy ?? 'unknown'}
          </p>
          {decision.answerMd && (
            <p className="mt-1 whitespace-pre-wrap break-words text-muted">{decision.answerMd}</p>
          )}
        </div>
      )}

      {error && <p className="field-error mt-3">{error}</p>}
    </li>
  )
}
