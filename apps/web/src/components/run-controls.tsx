import { useState } from 'react'
import { useNow } from '../hooks/use-now.ts'
import { formatDuration, nodeLabel } from '../lib/task-thread.ts'

function runLabel(nodeKey: string, attempt: number): string {
  return attempt > 0 ? `${nodeLabel(nodeKey)} · run ${attempt + 1}` : nodeLabel(nodeKey)
}

interface RunningStripProps {
  readonly nodeKey: string
  readonly attempt: number
  readonly startedAt: string | null
  /** The last recognized action of the running attempt, if it has reported one. */
  readonly activity: string | null
  readonly onStop: () => void
  readonly stopping: boolean
  readonly error?: string
}

/**
 * REQ-914/AC-931: stopping is always one click away while a stage runs, and the
 * click before the last one states the cost of stopping — the exact stage, the
 * provider spend already committed, and the uncommitted work that goes away.
 */
export function RunningStrip({
  nodeKey,
  attempt,
  startedAt,
  activity,
  onStop,
  stopping,
  error,
}: RunningStripProps) {
  const [confirming, setConfirming] = useState(false)
  const now = useNow()
  const started = startedAt ? new Date(startedAt).getTime() : null
  const elapsed = started === null ? null : formatDuration(now - started)

  return (
    <section className="border border-border border-l-2 border-l-phosphor bg-surface/60 p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="dot-live h-2 w-2 shrink-0 rounded-full bg-phosphor" aria-hidden="true" />
        <h2 className="text-sm font-medium">{runLabel(nodeKey, attempt)}</h2>
        <span className="font-mono text-xs text-muted">
          running{elapsed ? ` · ${elapsed}` : ''}
        </span>
        <button
          type="button"
          className="button-ghost ml-auto"
          disabled={stopping}
          onClick={() => setConfirming((open) => !open)}
        >
          {stopping ? 'Stopping…' : confirming ? 'Keep running' : 'Stop run'}
        </button>
      </div>

      {activity && (
        <p className="mt-2 truncate font-mono text-xs text-muted" role="status">
          {activity}
        </p>
      )}

      {confirming && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="text-sm leading-6 text-muted">
            Stopping <span className="text-text">{runLabel(nodeKey, attempt)}</span> may still incur
            provider cost. Every uncommitted change from this attempt is discarded; accepted commits
            stay.
          </p>
          <button type="button" className="button-danger mt-3" disabled={stopping} onClick={onStop}>
            Confirm stop
          </button>
        </div>
      )}

      {error && <p className="field-error">{error}</p>}
    </section>
  )
}

interface CleanupStripProps {
  readonly nodeKey: string
  readonly attempt: number
  readonly failed: boolean
  readonly failure: string | null
}

export function CleanupStrip({ nodeKey, attempt, failed, failure }: CleanupStripProps) {
  return (
    <section
      className={`border border-l-2 p-4 ${failed ? 'border-danger/40 border-l-danger' : 'border-border border-l-amber'}`}
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="micro-label text-amber">
          {failed ? 'Cleanup needs attention' : 'Stopping'}
        </span>
        <h2 className="text-sm font-medium">{runLabel(nodeKey, attempt)}</h2>
      </div>
      <p className="mt-2 text-sm leading-6 text-muted">
        {failed
          ? `The task stays paused and cannot restart: ${failure ?? 'cleanup failed'}`
          : 'The run is being terminated and its uncommitted work discarded. Restart unlocks once cleanup succeeds.'}
      </p>
    </section>
  )
}

interface RestartPanelProps {
  readonly nodeKey: string
  readonly attempt: number
  readonly guidance: string
  readonly onGuidanceChange: (value: string) => void
  readonly onRestart: () => void
  readonly busy: boolean
  readonly error?: string
}

export function RestartPanel({
  nodeKey,
  attempt,
  guidance,
  onGuidanceChange,
  onRestart,
  busy,
  error,
}: RestartPanelProps) {
  return (
    <section className="border border-border border-l-2 border-l-amber p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="micro-label text-amber">Paused</span>
        <h2 className="text-sm font-medium">{runLabel(nodeKey, attempt)}</h2>
        <span className="font-mono text-xs text-muted">uncommitted work discarded</span>
      </div>

      <details className="mt-3">
        <summary className="cursor-pointer font-mono text-[0.7rem] uppercase tracking-widest text-muted hover:text-text">
          Restart this stage…
        </summary>
        <p className="mt-3 text-sm leading-6 text-muted">
          The replacement starts from the last accepted commit and receives exactly the guidance
          below — nothing else from the stopped attempt reaches it.
        </p>
        <textarea
          className="control mt-3 min-h-20 w-full resize-y"
          value={guidance}
          onChange={(event) => onGuidanceChange(event.currentTarget.value)}
          placeholder="Optional guidance for the replacement attempt…"
          aria-label="Restart guidance"
        />
        <button type="button" className="button-primary mt-3" disabled={busy} onClick={onRestart}>
          {busy ? 'Restarting…' : 'Confirm restart'}
        </button>
      </details>

      {error && <p className="field-error">{error}</p>}
    </section>
  )
}
