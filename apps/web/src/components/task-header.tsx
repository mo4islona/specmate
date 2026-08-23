import type { StateTone, TaskStateSentence } from '../lib/task-state.ts'

const TONE_TEXT: Record<StateTone, string> = {
  running: 'text-phosphor',
  attention: 'text-amber',
  stopped: 'text-danger',
  done: 'text-muted',
}

const TONE_DOT: Record<StateTone, string> = {
  running: 'bg-phosphor dot-live',
  attention: 'bg-amber dot-live',
  stopped: 'bg-danger',
  done: 'bg-muted',
}

const STREAM_DOT: Record<string, string> = {
  live: 'bg-phosphor',
  connecting: 'bg-amber',
  stale: 'bg-danger',
}

interface TaskHeaderProps {
  readonly title: string
  readonly state: TaskStateSentence
  /** What the surface being shown is about — the repository, or the comparison. */
  readonly context: string
  readonly connection: string
}

/**
 * One row, four things. The state reads as a sentence because `BLOCKED` and
 * `HARNESS GAP: PARTIAL` were chips that had to be decoded; the trailing dot is
 * labelled because a task waiting on the owner is amber while its event stream
 * is perfectly healthy, and the two must not read as one claim.
 */
export function TaskHeader({ title, state, context, connection }: TaskHeaderProps) {
  return (
    <header className="flex flex-wrap items-baseline gap-x-4 gap-y-2 border-b border-border pb-3">
      <h1 className="min-w-0 shrink-0 break-words text-lg font-semibold tracking-tight">{title}</h1>

      <p className={`flex min-w-0 items-baseline gap-1.5 text-[0.82rem] ${TONE_TEXT[state.tone]}`}>
        <span
          className={`h-1.5 w-1.5 shrink-0 translate-y-[-0.1rem] rounded-full ${TONE_DOT[state.tone]}`}
          aria-hidden="true"
        />
        <span className="min-w-0">
          {state.headline}
          {state.detail && <span className="text-muted"> — {state.detail}</span>}
        </span>
      </p>

      <p className="min-w-0 truncate font-mono text-[0.68rem] text-muted">{context}</p>

      <span
        className="ml-auto flex shrink-0 items-center gap-1.5 font-mono text-[0.6rem] uppercase tracking-widest text-muted"
        title={`event stream ${connection}`}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${STREAM_DOT[connection] ?? 'bg-muted'}`}
          aria-hidden="true"
        />
        stream
      </span>
    </header>
  )
}
