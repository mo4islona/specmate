import { cn } from './cn.ts'

interface MeterProps {
  readonly done: number
  readonly total: number
  readonly label: string
  readonly className?: string
}

/**
 * A count as a length. The fraction beside it is the exact answer; this is the
 * one a reader takes in without reading — which is the whole point of a pass
 * having a bar rather than only a number.
 */
export function Meter({ done, total, label, className }: MeterProps) {
  const filled = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0

  return (
    <div
      className={cn('meter', className)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
    >
      <div className="meter-fill" style={{ width: `${filled * 100}%` }} />
    </div>
  )
}

/** Blocks in the bar. Five is GitHub's, and enough to compare two files by eye. */
const BLOCKS = 5

interface StatBarProps {
  readonly additions: number
  readonly deletions: number
  readonly className?: string
}

/**
 * A file's weight, drawn. The blocks are shares of the file's own change, not of
 * the comparison — the question they answer is "how much of this was added and
 * how much taken away", which is what a reviewer reads a `+N −N` for.
 */
function blocks(additions: number, deletions: number): { added: number; removed: number } {
  const total = additions + deletions
  if (total === 0) return { added: 0, removed: 0 }
  if (deletions === 0) return { added: BLOCKS, removed: 0 }
  if (additions === 0) return { added: 0, removed: BLOCKS }

  // Both sides keep a block: rounding a 1-line removal out of 400 to zero would
  // draw a file that lost lines as one that only gained them.
  const added = Math.min(BLOCKS - 1, Math.max(1, Math.round((additions / total) * BLOCKS)))

  return { added, removed: BLOCKS - added }
}

export function StatBar({ additions, deletions, className }: StatBarProps) {
  const { added, removed } = blocks(additions, deletions)

  return (
    <span
      className={cn('stat-bar', className)}
      aria-hidden="true"
      title={`+${additions} −${deletions}`}
    >
      {Array.from({ length: BLOCKS }, (_, index) => (
        <span
          // Fixed-length bar; a block's position is its identity.
          // biome-ignore lint/suspicious/noArrayIndexKey: static list, no reordering
          key={index}
          className={cn(
            'stat-block',
            index < added && 'stat-block-add',
            index >= added && index < added + removed && 'stat-block-remove',
          )}
        />
      ))}
    </span>
  )
}
