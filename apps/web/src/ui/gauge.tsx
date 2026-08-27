import * as ProgressPrimitive from '@radix-ui/react-progress'
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
 *
 * The maximum is floored at one because a pass with nothing in it still renders:
 * Radix reads a zero maximum as a mistake and says so, and an empty bar is not
 * a mistake, it is a pass that has not been given any work yet.
 */
export function Meter({ done, total, label, className }: MeterProps) {
  const max = Math.max(1, total)
  const value = Math.min(max, Math.max(0, done))

  return (
    <ProgressPrimitive.Root
      value={value}
      max={max}
      aria-label={label}
      className={cn(
        'h-[0.3rem] w-full overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--color-foreground)_9%,transparent)]',
        className,
      )}
    >
      <ProgressPrimitive.Indicator
        className="h-full rounded-[inherit] bg-success transition-[width] duration-[180ms] ease-out"
        style={{ width: `${(value / max) * 100}%` }}
      />
    </ProgressPrimitive.Root>
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

/** Five blocks for a file's weight, so a stack of them compares at a glance. */
const BLOCK = 'h-[0.3rem] w-[0.3rem] rounded-[1.5px]'
const BLOCK_EMPTY = 'bg-[color-mix(in_srgb,var(--color-foreground)_16%,transparent)]'

export function StatBar({ additions, deletions, className }: StatBarProps) {
  const { added, removed } = blocks(additions, deletions)

  return (
    <span
      className={cn('inline-flex gap-[2px]', className)}
      aria-hidden="true"
      title={`+${additions} −${deletions}`}
    >
      {Array.from({ length: BLOCKS }, (_, index) => (
        <span
          // Fixed-length bar; a block's position is its identity.
          // biome-ignore lint/suspicious/noArrayIndexKey: static list, no reordering
          key={index}
          className={cn(
            BLOCK,
            index < added && 'bg-success',
            index >= added && index < added + removed && 'bg-destructive',
            index >= added + removed && BLOCK_EMPTY,
          )}
        />
      ))}
    </span>
  )
}
