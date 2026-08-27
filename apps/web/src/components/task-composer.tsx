import { type FormEvent, type KeyboardEvent, type ReactNode, useEffect, useRef } from 'react'
import type { ConsoleDestination, ConsoleTone } from '../lib/task-console.ts'
import {
  Button,
  Console,
  ConsoleField,
  cn,
  ErrorNote,
  type ConsoleTone as SlabTone,
} from '../ui/index.ts'
import { ArtifactMarkdown } from './artifact-markdown.tsx'
import { consoleSignal, signalText } from './tone.ts'

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
  /** Stopping the run that is under way, where one is (REQ-914). */
  readonly stop?: ReactNode
  /** The verbs the state owns — a gate's rework and redirect. */
  readonly actions?: ReactNode
  /** Quiet ways out, at the trailing end of the control row. */
  readonly escapes?: ReactNode
}

/** The slab's accent, which the mark and the focus ring both read. */
const TONE_SLAB: Record<ConsoleTone, SlabTone> = {
  asking: 'asking',
  running: 'plain',
  stopped: 'stopped',
  spent: 'spent',
  plain: 'plain',
}

function markClass(tone: ConsoleTone): string {
  const live = tone === 'running' ? 'dot-live ' : ''

  return `${live}${signalText(consoleSignal(tone))}`
}

/**
 * One input, and one row of verbs on it (REQ-921). No mode to set and no target
 * to pick: the previous composer asked for two decisions before a word could be
 * typed, and neither reached any agent.
 *
 * Everything that acts sits in that one row — stop, send, and whatever the
 * state owns — because a second strip outside the block was where the sentences
 * nobody reads accumulated. The row sits under the field, on the block's own
 * surface, the way it does anywhere else a person writes something and then
 * decides what to do with it.
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
  stop,
  actions,
  escapes,
}: TaskComposerProps) {
  const disabled = destination.unavailable !== null
  const urgent = destination.tone === 'asking' || destination.tone === 'stopped'
  const field = useRef<HTMLTextAreaElement | null>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: the text is the trigger, not an input — the field is measured *because* what is in it changed.
  useEffect(() => {
    const node = field.current
    if (!node) return

    node.style.height = 'auto'
    node.style.height = `${node.scrollHeight}px`
  }, [value])

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
    <Console tone={TONE_SLAB[destination.tone]} onSubmit={submit}>
      {question ? (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-4 pt-3">
          <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 font-mono text-[0.72rem] leading-5">
            <Mark tone={destination.tone} />
            <span className={cn('min-w-0', signalText('asking'))}>
              {question.label} · question {question.index + 1} of {question.total}
            </span>

            {question.stopped && (
              <span className={signalText('stopped')} role="status">
                The task is stopped on this.
              </span>
            )}
          </p>

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
          <p className="flex items-baseline gap-2 px-4 pt-3 font-mono text-[0.72rem] leading-5 text-muted-foreground">
            <Mark tone={destination.tone} />
            <span className="min-w-0">
              {destination.head.to && (
                <span className={signalText(consoleSignal(destination.tone))}>
                  {destination.head.to} ·{' '}
                </span>
              )}
              {destination.head.note}
            </span>
          </p>
        )
      )}

      {question && (
        <div className="artifact-document px-4 pt-3 text-[0.92rem] leading-7">
          <ArtifactMarkdown content={question.promptMd} />
        </div>
      )}

      {question?.options}

      {/* The frame around the console is the field's own box. A bordered input
          inside a bordered form drew the same rectangle twice, and the inner
          one carried nothing the outer one did not already say. */}
      <div className="px-4 pb-1 pt-3">
        <ConsoleField
          ref={field}
          rows={1}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          onKeyDown={onKeyDown}
          placeholder={destination.placeholder}
          aria-label={destination.label}
          disabled={disabled}
        />
      </div>

      {(error || question?.error) && (
        <ErrorNote className="px-4 pb-1">{error ?? question?.error}</ErrorNote>
      )}

      {/* The one row that acts, under the one field that types. */}
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5 pb-3 pl-1.5 pr-4">
        {stop}

        {question && (
          <>
            <Button variant="ghost" disabled={question.busy} onClick={question.onDismiss}>
              Dismiss
            </Button>
            {question.onDiscuss && (
              <Button variant="ghost" disabled={question.busy} onClick={question.onDiscuss}>
                Discuss
              </Button>
            )}
          </>
        )}

        {actions}
        {escapes}

        <span className="flex-1" />

        <Button
          variant={urgent ? 'warning' : 'primary'}
          className="min-h-9 shrink-0 py-1.5"
          type="submit"
          disabled={disabled || !value.trim()}
          pending={busy}
          pendingLabel="Sending…"
        >
          {destination.submit}
        </Button>
      </div>
    </Console>
  )
}

/** The console's mood in one character — breathing while a node runs. */
function Mark({ tone }: { tone: ConsoleTone }) {
  return (
    <span className={cn('shrink-0 leading-none', markClass(tone))} aria-hidden="true">
      ●
    </span>
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
    <div className="flex items-center gap-1 font-mono text-[0.7rem] text-muted-foreground">
      <button
        type="button"
        aria-label="Previous question"
        className="px-1 disabled:opacity-30"
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
          className={cn(
            'grid h-5 w-5 place-items-center rounded-md text-[0.62rem] transition-colors',
            step === index
              ? 'bg-foreground/15 font-semibold text-foreground'
              : 'text-muted-foreground hover:bg-foreground/8 hover:text-foreground',
          )}
          onClick={() => onPage(step)}
        >
          {step + 1}
        </button>
      ))}
      <button
        type="button"
        aria-label="Next question"
        className="px-1 disabled:opacity-30"
        disabled={disabled || index === total - 1}
        onClick={() => onPage(index + 1)}
      >
        ›
      </button>
    </div>
  )
}
