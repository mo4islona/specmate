import { useState } from 'react'
import { nodeLabel } from '../lib/task-thread.ts'
import { Button, ErrorNote, Popover } from '../ui/index.ts'

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
 * It lives in the console's control row, beside Send: the two things an owner
 * does to a running task are one reach apart, and the confirmation opens over
 * the field rather than in a column they had to look away to find.
 */
export function StopControl({ nodeKey, attempt, onStop, stopping, error }: StopControlProps) {
  const [confirming, setConfirming] = useState(false)

  return (
    <>
      <Popover
        open={confirming}
        onDismiss={() => setConfirming(false)}
        role="dialog"
        label="Confirm stop"
        trigger={
          <Button
            variant="ghost-destructive"
            disabled={stopping}
            aria-expanded={confirming}
            onClick={() => setConfirming(!confirming)}
          >
            {stopping ? 'Stopping…' : '■ Stop'}
          </Button>
        }
      >
        <p className="text-[0.78rem] leading-6 text-muted-foreground">
          Stopping <span className="text-foreground">{runLabel(nodeKey, attempt)}</span> may still
          incur provider cost. Every uncommitted change from this attempt is discarded; accepted
          commits stay.
        </p>

        <div className="mt-3 flex items-center justify-end gap-1">
          <Button variant="ghost" disabled={stopping} onClick={() => setConfirming(false)}>
            Keep running
          </Button>
          <Button variant="destructive" disabled={stopping} onClick={onStop}>
            Confirm stop
          </Button>
        </div>
      </Popover>

      {error && <ErrorNote className="w-full px-2.5 text-[0.72rem]/[1.4]">{error}</ErrorNote>}
    </>
  )
}
