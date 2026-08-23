import type { FormEvent, KeyboardEvent, ReactNode } from 'react'
import type { ConsoleDestination, ConsoleTone } from '../lib/task-console.ts'
import { ArtifactMarkdown } from './artifact-markdown.tsx'

/** The one open question the console is answering, and its siblings as a pager. */
export interface OpenQuestion {
  readonly label: string
  /** Position among the open questions, zero-based. */
  readonly index: number
  readonly total: number
  readonly promptMd: string
  /** True when this question is the reason the task is parked. */
  readonly stopped: boolean
  /** The question's own options, rendered as direct actions above the input. */
  readonly options: ReactNode
  readonly onPage: (index: number) => void
  readonly onDismiss: () => void
  readonly onDiscuss?: () => void
  readonly busy: boolean
  readonly error?: string
}

interface TaskComposerProps {
  readonly destination: ConsoleDestination
  readonly value: string
  readonly onChange: (value: string) => void
  readonly busy: boolean
  readonly error?: string
  readonly onSubmit: () => void
  readonly question?: OpenQuestion | null
  /** The verbs the state owns — a gate's rework and redirect. */
  readonly actions?: ReactNode
  /** Quiet ways out, at the trailing end of the footer. */
  readonly escapes?: ReactNode
}

const TONE_FRAME: Record<ConsoleTone, string> = {
  asking: 'border-amber/45 border-l-2 border-l-amber bg-amber/[0.03]',
  running: 'border-border-bright border-l-2 border-l-phosphor',
  stopped: 'border-border-bright border-l-2 border-l-danger',
  spent: 'border-border border-l-2 border-l-border-bright opacity-85',
  plain: 'border-border-bright',
}

const HEAD_TONE: Record<ConsoleTone, string> = {
  asking: 'text-amber',
  running: 'text-phosphor',
  stopped: 'text-danger',
  spent: 'text-muted',
  plain: 'text-phosphor',
}

/**
 * One input, and one line saying where the text goes (REQ-921). No mode to set
 * and no target to pick: the previous composer asked for two decisions before a
 * word could be typed, and neither reached any agent.
 *
 * An open question is the console's own head rather than a card above it
 * (REQ-912) — the question and the field that answers it are one thing, and
 * splitting them is what put a fold between them.
 */
export function TaskComposer({
  destination,
  value,
  onChange,
  busy,
  error,
  onSubmit,
  question,
  actions,
  escapes,
}: TaskComposerProps) {
  const disabled = destination.unavailable !== null
  const urgent = destination.tone === 'asking' || destination.tone === 'stopped'

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!disabled && value.trim()) onSubmit()
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && value.trim() && !disabled) {
      event.preventDefault()
      onSubmit()
    }
  }

  return (
    <form className={`border bg-surface ${TONE_FRAME[destination.tone]}`} onSubmit={submit}>
      {question ? (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-3 py-2">
          <p className="micro-label text-amber">
            {question.label} · question {question.index + 1} of {question.total}
          </p>

          {question.stopped ? (
            <p className="font-mono text-[0.62rem] text-danger" role="status">
              The task is stopped on this.
            </p>
          ) : null}

          {question.total > 1 && (
            <Pager
              index={question.index}
              total={question.total}
              onPage={question.onPage}
              disabled={question.busy}
            />
          )}
        </div>
      ) : (
        destination.head && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-3 py-2">
            <p className="micro-label flex items-center gap-1.5 text-muted">
              <span aria-hidden="true">→</span>
              <span className={HEAD_TONE[destination.tone]}>{destination.head.to}</span>
              <span className="font-normal normal-case tracking-normal">
                · {destination.head.note}
              </span>
            </p>
          </div>
        )
      )}

      {question && (
        <div className="artifact-document px-3 pb-1 pt-3 text-[0.92rem] leading-7">
          <ArtifactMarkdown content={question.promptMd} />
        </div>
      )}

      {question?.options}

      {/* Bottom-aligned: a primary button stretched to a resized textarea is a
          slab of accent colour where a verb should be. */}
      <div className="flex flex-col gap-2 p-3 sm:flex-row sm:items-end">
        <textarea
          className="control min-h-14 w-full min-w-0 flex-1 resize-y text-sm disabled:cursor-not-allowed disabled:border-dashed disabled:text-muted"
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          onKeyDown={onKeyDown}
          placeholder={destination.placeholder}
          aria-label={destination.label}
          disabled={disabled}
        />
        <button
          className={`${urgent ? 'button-attention' : 'button-primary'} shrink-0 sm:w-28`}
          type="submit"
          disabled={disabled || !value.trim() || busy}
        >
          {busy ? 'Sending…' : destination.submit}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border px-2 py-1.5">
        {question && (
          <>
            <button
              type="button"
              className="button-ghost"
              disabled={question.busy}
              onClick={question.onDismiss}
            >
              Dismiss
            </button>
            {question.onDiscuss && (
              <button
                type="button"
                className="button-ghost"
                disabled={question.busy}
                onClick={question.onDiscuss}
              >
                Discuss
              </button>
            )}
          </>
        )}

        {actions}

        <span className="flex-1" />

        {destination.line && (
          <p className="font-mono text-[0.62rem] leading-4 text-muted">
            {destination.line}
            {!disabled && <span className="text-muted/60"> · ⌘↵ to send</span>}
          </p>
        )}

        {escapes}
      </div>

      {(error || question?.error) && (
        <p className="field-error px-3 pb-2">{error ?? question?.error}</p>
      )}
    </form>
  )
}

function Pager({
  index,
  total,
  onPage,
  disabled,
}: {
  index: number
  total: number
  onPage: (index: number) => void
  disabled: boolean
}) {
  const steps = Array.from({ length: total }, (_value, position) => position)

  return (
    <div className="flex items-center gap-1.5 font-mono text-[0.7rem] text-muted">
      <button
        type="button"
        aria-label="Previous question"
        className="px-1 disabled:opacity-40"
        disabled={disabled || index === 0}
        onClick={() => onPage(index - 1)}
      >
        ‹
      </button>
      {steps.map((step) => (
        <button
          key={step}
          type="button"
          aria-label={`Question ${step + 1}`}
          aria-current={step === index ? 'true' : undefined}
          disabled={disabled}
          className={`grid h-[1.1rem] w-[1.1rem] place-items-center border text-[0.6rem] font-semibold ${
            step === index
              ? 'border-amber bg-amber text-ground'
              : 'border-border-bright text-muted hover:text-text'
          }`}
          onClick={() => onPage(step)}
        >
          {step + 1}
        </button>
      ))}
      <button
        type="button"
        aria-label="Next question"
        className="px-1 disabled:opacity-40"
        disabled={disabled || index === total - 1}
        onClick={() => onPage(index + 1)}
      >
        ›
      </button>
    </div>
  )
}
