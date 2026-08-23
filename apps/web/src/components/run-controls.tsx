import { useState } from 'react'
import { nodeLabel } from '../lib/task-thread.ts'

interface StopControlProps {
  readonly nodeKey: string
  readonly attempt: number
  readonly onStop: () => void
  readonly stopping: boolean
  readonly error?: string
}

function runLabel(nodeKey: string, attempt: number): string {
  return attempt > 0 ? `${nodeLabel(nodeKey)} · run ${attempt + 1}` : nodeLabel(nodeKey)
}

/**
 * REQ-914/AC-931: stopping is always one click away while a stage runs, and the
 * click before the last one states the cost of stopping — the exact stage, the
 * provider spend already committed, and the uncommitted work that goes away.
 * It lives under the running node in the rail, because that is where the run
 * itself is reported and a fact belongs in one place.
 */
export function StopControl({ nodeKey, attempt, onStop, stopping, error }: StopControlProps) {
  const [confirming, setConfirming] = useState(false)

  return (
    <div>
      <button
        type="button"
        className="button-ghost min-h-7 px-0 text-[0.62rem]"
        disabled={stopping}
        onClick={() => setConfirming((open) => !open)}
      >
        {stopping ? 'Stopping…' : confirming ? '← Keep running' : '■ Stop'}
      </button>

      {confirming && (
        <div className="mt-1">
          <p className="text-[0.72rem] leading-5 text-muted">
            Stopping <span className="text-text">{runLabel(nodeKey, attempt)}</span> may still incur
            provider cost. Every uncommitted change from this attempt is discarded; accepted commits
            stay.
          </p>
          <button
            type="button"
            className="button-danger mt-2 min-h-8 py-1 text-[0.62rem]"
            disabled={stopping}
            onClick={onStop}
          >
            Confirm stop
          </button>
        </div>
      )}

      {error && <p className="field-error text-[0.72rem]">{error}</p>}
    </div>
  )
}
