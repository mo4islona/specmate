import type { ReactNode } from 'react'
import { Link, useLocation } from 'wouter'
import type { StreamConnectionState } from '../lib/event-stream.ts'
import { useStreamStatus } from '../lib/stream-status.ts'
import { GearIcon, SpecMateMark } from './icons.tsx'
import { TaskNavigation } from './task-navigation.tsx'

/**
 * The stream is only news when it is not working. A `live` badge on every
 * screen told the owner nothing they could act on; these two are the states
 * where what they are reading may be behind what is happening.
 */
const STREAM_TROUBLE: Partial<Record<StreamConnectionState, { label: string; tone: string }>> = {
  connecting: { label: 'reconnecting', tone: 'text-attention' },
  stale: { label: 'stream stalled', tone: 'text-danger' },
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
  const trouble = stream ? STREAM_TROUBLE[stream] : undefined

  return (
    <Link href="/" className="flex min-w-0 items-center gap-2.5">
      <SpecMateMark stream={stream} className={`shrink-0 ${compact ? 'h-6 w-6' : 'h-7 w-7'}`} />
      <span
        className={`font-mono font-semibold tracking-[0.02em] text-text ${
          compact ? 'text-sm' : 'text-base'
        }`}
      >
        SPECMATE
      </span>

      {trouble && (
        <span
          className={`min-w-0 truncate font-mono text-[0.62rem] ${trouble.tone}`}
          role="status"
          title={`event stream ${stream}`}
        >
          {trouble.label}
        </span>
      )}
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
    <div className="min-h-screen bg-ground text-text lg:grid lg:grid-cols-[18rem_minmax(0,1fr)]">
      {/* One gutter down the whole column: the mark, the group headings and the
          rows all start on it, and each row's own box reaches half a gutter past
          it on either side so that pointing at one has an edge to show. */}
      <aside className="hidden flex-col border-r border-border bg-surface lg:sticky lg:top-0 lg:flex lg:h-screen">
        <div className="rail-inset border-b border-border">
          <Lockup stream={stream} />

          <Link href="/tasks/new" className="button-secondary mt-4 flex w-full justify-center">
            + Launch task
          </Link>
        </div>

        <div className="scroll-thin rail-inset flex-1 overflow-y-auto">
          <TaskNavigation />
        </div>

        <div className="rail-inset border-t border-border">
          <Link
            href="/settings"
            aria-current={isSettings ? 'page' : undefined}
            className={`rail-row flex items-center gap-2 rounded-lg py-2 font-mono text-xs uppercase tracking-widest transition-colors ${
              isSettings
                ? 'bg-accent/[0.09] text-text'
                : 'text-muted hover:bg-text/[0.05] hover:text-text'
            }`}
          >
            <GearIcon className="h-4 w-4 shrink-0" />
            Settings
          </Link>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="shell-main sticky top-0 z-20 border-b border-border bg-ground/95 py-3 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between gap-3">
            <Lockup stream={stream} compact />

            <div className="flex shrink-0 items-center gap-2">
              <Link href="/tasks/new" className="button-secondary">
                + Task
              </Link>
              <Link
                href="/settings"
                aria-current={isSettings ? 'page' : undefined}
                aria-label="Settings"
                className="button-ghost"
              >
                <GearIcon className="h-4 w-4 shrink-0" />
              </Link>
            </div>
          </div>

          <details className="mt-3 border-t border-border pt-2">
            <summary className="cursor-pointer py-1 font-mono text-xs uppercase tracking-widest text-muted">
              Task index
            </summary>
            <div className="max-h-[55vh] overflow-y-auto pt-3">
              <TaskNavigation />
            </div>
          </details>
        </header>

        <main className="shell-main mx-auto min-h-screen w-full max-w-[100rem] overflow-x-hidden">
          {children}
        </main>
      </div>
    </div>
  )
}
