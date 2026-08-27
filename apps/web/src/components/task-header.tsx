import type { ReactNode } from 'react'
import type { TaskStateSentence } from '../lib/task-state.ts'
import { cx, Dot } from '../ui/index.ts'
import { signalBreathes, signalDot, signalText, stateSignal } from './tone.ts'

interface TaskHeaderProps {
  readonly title: string
  readonly state: TaskStateSentence
  /** What qualifies the state and nothing else — the harness gap, the plan size. */
  readonly badges?: ReactNode
}

/**
 * One row, about the task and nothing else. The event stream used to report
 * here too, and it was the wrong header for it twice over: the state of the
 * connection is not the state of the work, and a `reconnecting` appearing in
 * the corner pushed the repository onto a second line every time the stream
 * blinked. The shell's mark carries it now.
 */
export function TaskHeader({ title, state, badges }: TaskHeaderProps) {
  const signal = stateSignal(state.tone)

  return (
    <header className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
      <h1 className="min-w-0 break-words text-lg font-semibold tracking-tight">{title}</h1>

      <p className={cx('flex min-w-0 items-baseline gap-1.5 text-[0.82rem]', signalText(signal))}>
        <Dot
          className={cx('translate-y-[-0.1rem]', signalDot(signal))}
          live={signalBreathes(signal)}
        />
        <span className="min-w-0">
          {state.headline}
          {state.detail && <span className="text-muted-foreground"> — {state.detail}</span>}
        </span>
      </p>

      {badges}
    </header>
  )
}
