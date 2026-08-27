import type { ReactNode } from 'react'
import { Link, useLocation } from 'wouter'
import type { StreamConnectionState } from '../lib/event-stream.ts'
import { useStreamStatus } from '../lib/stream-status.ts'
import { ButtonLink, cn, Icon, NavRow, Working } from '../ui/index.ts'
import { SpecMateMark } from './mark.tsx'
import { TaskNavigation } from './task-navigation.tsx'
import { signalText, streamSignal } from './tone.ts'

/**
 * The stream is only news when it is not working. A `live` badge on every
 * screen told the owner nothing they could act on; these two are the states
 * where what they are reading may be behind what is happening.
 */
const STREAM_TROUBLE: Partial<Record<StreamConnectionState, string>> = {
  connecting: 'reconnecting',
  stale: 'stream stalled',
}

interface LockupProps {
  readonly stream: StreamConnectionState | null
  /** The mobile header sets the same lockup a size down. */
  readonly compact?: boolean
}

/**
 * The mark, the name, and — when there is trouble — what the event stream is
 * doing. It reports there rather than in the corner of the task screen for two
 * reasons: the corner had `reconnecting` elbowing the repository onto a second
 * line every time the connection blinked, and the stream is the app's link to
 * the machine, not a property of whichever task is open.
 */
function Lockup({ stream, compact = false }: LockupProps) {
  const label = stream ? STREAM_TROUBLE[stream] : undefined

  return (
    <Link href="/" className="flex min-w-0 items-center gap-2.5">
      <SpecMateMark stream={stream} className={cn('shrink-0', compact ? 'h-6 w-6' : 'h-7 w-7')} />

      {/* Baseline, not centre: the state is an annotation on the name, and a
          tiny word centred against a 28px mark floats beside the lockup rather
          than belonging to it. */}
      <span className="flex min-w-0 items-baseline gap-2">
        <span
          className={cn(
            'font-mono font-semibold tracking-[0.02em] text-foreground',
            compact ? 'text-sm' : 'text-base',
          )}
        >
          SPECMATE
        </span>

        {label && stream && (
          <span
            className={cn(
              'min-w-0 truncate font-mono text-[0.62rem] tracking-[0.1em]',
              signalText(streamSignal(stream)),
            )}
            role="status"
            title={`event stream ${stream}`}
          >
            {/* Reaching, at the word's scale: the mark's chevrons chase the
                stream and the ellipsis keeps the same time. A stall is not a
                wait in progress, so it says so and holds still. */}
            {stream === 'connecting' ? <Working>{label}</Working> : label}
          </span>
        )}
      </span>
    </Link>
  )
}

interface AppShellProps {
  children: ReactNode
}

export function AppShell({ children }: AppShellProps) {
  const [location] = useLocation()
  const isSettings = location.startsWith('/settings')
  const stream = useStreamStatus()

  return (
    <div className="min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[18rem_minmax(0,1fr)]">
      {/* One gutter down the whole column: the mark, the group headings and the
          rows all start on it, and each row's own box reaches half a gutter past
          it on either side so that pointing at one has an edge to show. */}
      <aside className="hidden flex-col border-r border-border bg-card lg:sticky lg:top-0 lg:flex lg:h-screen">
        <div className="p-[var(--rail-gutter)] border-b border-border">
          <Lockup stream={stream} />

          <ButtonLink href="/tasks/new" className="mt-4 flex w-full justify-center">
            + Launch task
          </ButtonLink>
        </div>

        <div className="scroll-thin p-[var(--rail-gutter)] flex-1 overflow-y-auto">
          <TaskNavigation />
        </div>

        <div className="p-[var(--rail-gutter)] border-t border-border">
          <NavRow
            href="/settings"
            active={isSettings}
            className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest"
          >
            <Icon name="settings" size="md" />
            Settings
          </NavRow>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="p-[var(--shell-gutter)] sticky top-0 z-20 border-b border-border bg-background/95 py-3 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between gap-3">
            <Lockup stream={stream} compact />

            <div className="flex shrink-0 items-center gap-2">
              <ButtonLink href="/tasks/new">+ Task</ButtonLink>
              <ButtonLink
                href="/settings"
                variant="ghost"
                aria-current={isSettings ? 'page' : undefined}
                aria-label="Settings"
              >
                <Icon name="settings" size="md" />
              </ButtonLink>
            </div>
          </div>

          <details className="mt-3 border-t border-border pt-2">
            <summary className="cursor-pointer py-1 font-mono text-xs uppercase tracking-widest text-muted-foreground">
              Task index
            </summary>
            <div className="max-h-[55vh] overflow-y-auto pt-3">
              <TaskNavigation />
            </div>
          </details>
        </header>

        {/* `clip`, not `hidden`: an element with one axis hidden and the other
            visible has the visible one computed to `auto`, which quietly made
            this a vertical scroll container wrapping every screen. */}
        <main className="p-[var(--shell-gutter)] mx-auto min-h-screen w-full max-w-[100rem] overflow-x-clip">
          {children}
        </main>
      </div>
    </div>
  )
}
