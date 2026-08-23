import type { FormEvent, KeyboardEvent, ReactNode } from 'react'
import type { ConsoleDestination } from '../lib/task-console.ts'

interface TaskComposerProps {
  readonly destination: ConsoleDestination
  readonly value: string
  readonly onChange: (value: string) => void
  readonly busy: boolean
  readonly error?: string
  readonly onSubmit: () => void
  /** The verbs the state owns — a gate's approve/rework/redirect, a stopped node's restart. */
  readonly actions?: ReactNode
  /** What to offer when there is nowhere to send: raise the cap, and nothing else. */
  readonly recovery?: ReactNode
}

/**
 * One input, and one line saying where the text goes (REQ-921). No mode to set
 * and no target to pick: the previous composer asked for two decisions before a
 * word could be typed, and neither reached any agent.
 */
export function TaskComposer({
  destination,
  value,
  onChange,
  busy,
  error,
  onSubmit,
  actions,
  recovery,
}: TaskComposerProps) {
  const disabled = destination.unavailable !== null

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
    <form className="border border-border bg-surface" onSubmit={submit}>
      <textarea
        className="min-h-16 w-full resize-y border-0 bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-muted/70 disabled:cursor-not-allowed disabled:text-muted"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={onKeyDown}
        placeholder={disabled ? destination.unavailable : undefined}
        aria-label={destination.label}
        disabled={disabled}
      />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border px-3 py-2">
        {/* Its own row until there is width for it: squeezed between the state's
            verbs it wraps to one word per line, which is unreadable. */}
        <p className="min-w-0 basis-full font-mono text-[0.62rem] leading-4 text-muted sm:basis-0 sm:flex-1">
          {destination.line}
          {!disabled && <span className="text-muted/60"> · ⌘↵ to send</span>}
        </p>

        {recovery}

        {actions}

        {!disabled && (
          <button
            className="button-primary min-h-9 py-1"
            type="submit"
            disabled={!value.trim() || busy}
          >
            {busy ? 'Sending…' : destination.kind === 'question' ? 'Answer' : 'Send'}
          </button>
        )}
      </div>

      {error && <p className="field-error px-3 pb-2">{error}</p>}
    </form>
  )
}
