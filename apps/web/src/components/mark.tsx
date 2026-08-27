import type { StreamConnectionState } from '../lib/event-stream.ts'
import { signalText, streamSignal } from './tone.ts'

/**
 * The one drawing this app owns. Everything else that is a shape rather than a
 * word comes from `ui/icon.tsx`; a logo is not an icon, and this one carries a
 * reading of the event stream on top.
 */

/** How the run stepping out of the brackets is drawn while the stream is in each state. */
function runTone(stream: StreamConnectionState): string {
  const reaching = stream === 'connecting' ? ' mark-reach' : ''

  return signalText(streamSignal(stream)) + reaching
}

interface MarkProps {
  readonly className?: string
  /** Absent while no task screen is open, and so nothing to report. */
  readonly stream?: StreamConnectionState | null
}

/**
 * The SpecMate mark: the spec's brackets, with the run stepping out of them.
 * Both groups stroke in `currentColor` so the lockup takes the theme's own
 * colours rather than the export's hard-coded hex.
 *
 * The run is also where the event stream is reported. The three chevrons ramp
 * from faint to solid already, which is the shape of a signal: reaching for the
 * stream chases them, and a stalled one stops them in the colour of trouble.
 */
export function SpecMateMark({ className, stream = null }: MarkProps) {
  const run = runTone(stream ?? 'live')
  const stalled = stream === 'stale'

  return (
    <svg
      viewBox="0 0 100 100"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <g className="text-foreground" stroke="currentColor" strokeWidth={7}>
        <path d="M36 22 H21 V78 H36" />
        <path d="M66 22 H81 V78 H66" />
      </g>
      <g className={run} stroke="currentColor" strokeWidth={8}>
        <path d="M40 35 L48 50 L40 65" opacity=".18" />
        <path d="M46 35 L54 50 L46 65" opacity=".45" />
        {/* The run has stopped arriving: the chevron that lands loses its weight. */}
        <path d="M52 35 L60 50 L52 65" opacity={stalled ? '.45' : '1'} />
      </g>
    </svg>
  )
}
