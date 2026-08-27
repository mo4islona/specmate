import type { ReactNode } from 'react'
import { cn } from './cn.ts'
import { ListRow } from './rows.tsx'

interface WaitingProps {
  /** What is on the way, as a sentence, for anyone who is not looking at it. */
  readonly label: string
  readonly className?: string
  readonly children: ReactNode
}

/**
 * The frame every drawn wait needs. The slots inside it are hidden from the
 * accessibility tree — six grey rectangles are worth nothing to a screen reader
 * — so without something saying what is on the way, a pane in flight is silence.
 * `aria-busy` is the other half: it is what tells a reader the pane is not
 * simply empty.
 */
export function Waiting({ label, className, children }: WaitingProps) {
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">{label}</span>

      {children}
    </div>
  )
}

/**
 * The slot a fact will land in — a line of prose, a path, a count. Its size is
 * the call site's to say, because a slot only reads as a wait if it is the shape
 * of the thing that is missing.
 *
 * Every one of these is hidden from the accessibility tree. A screen reader has
 * no use for six grey rectangles; what it needs is the one sentence saying what
 * is being waited on, and that belongs to the pane, not to the slots.
 */
export function Skeleton({ className }: { readonly className?: string }) {
  return <span aria-hidden="true" className={cn('skeleton', className)} />
}

/**
 * Six widths, so a waiting paragraph has the ragged right edge prose has rather
 * than the flush one a stack of bars has. They are a table with names rather
 * than a cycle over an index because a repeated width is not an identity, and a
 * key has to be one.
 */
const TEXT_LINES = [
  { id: 'one', width: 'w-full' },
  { id: 'two', width: 'w-11/12' },
  { id: 'three', width: 'w-full' },
  { id: 'four', width: 'w-4/5' },
  { id: 'five', width: 'w-11/12' },
  { id: 'six', width: 'w-3/4' },
] as const

interface SkeletonTextProps {
  /** How many lines the answer runs to. Six is as long as a wait is worth drawing. */
  readonly lines?: 1 | 2 | 3 | 4 | 5 | 6
  readonly className?: string
}

/** A paragraph that has not arrived: a document, a record, a description. */
export function SkeletonText({ lines = 3, className }: SkeletonTextProps) {
  const drawn = TEXT_LINES.slice(0, lines)

  return (
    <div className={cn('space-y-2.5', className)}>
      {drawn.map((line, index) => (
        <Skeleton
          key={line.id}
          // The last line of a paragraph stops early wherever the paragraph ends.
          className={cn('h-3', index === drawn.length - 1 ? 'w-2/5' : line.width)}
        />
      ))}
    </div>
  )
}

/** A row is a name over a fact, and no two names in a rail are the same length. */
const ROW_LINES = [
  { id: 'one', name: 'w-4/5', fact: 'w-1/3' },
  { id: 'two', name: 'w-3/5', fact: 'w-1/4' },
  { id: 'three', name: 'w-11/12', fact: 'w-2/5' },
  { id: 'four', name: 'w-2/3', fact: 'w-1/3' },
  { id: 'five', name: 'w-3/4', fact: 'w-1/5' },
  { id: 'six', name: 'w-1/2', fact: 'w-1/3' },
] as const

interface SkeletonRowsProps {
  readonly rows?: 2 | 3 | 4 | 5 | 6
  /** A rail row leads with a mark; a list of paths and counts does not. */
  readonly mark?: boolean
  readonly className?: string
}

/**
 * A rail waiting on its list, at the rhythm the rows will have — the task index,
 * a task's documents, the files a run changed. Drawn rather than said because
 * the sentence "Loading task index…" left the whole sidebar empty, and a sidebar
 * that empties itself every time the page reloads reads as a sidebar with
 * nothing in it.
 */
export function SkeletonRows({ rows = 5, mark = false, className }: SkeletonRowsProps) {
  return (
    <div className={cn('space-y-3.5', className)}>
      {ROW_LINES.slice(0, rows).map((row) => (
        <div key={row.id} className="flex gap-2.5">
          {mark && <Skeleton className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" />}

          <span className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className={cn('h-3', row.name)} />
            <Skeleton className={cn('h-2', row.fact)} />
          </span>
        </div>
      ))}
    </div>
  )
}

/**
 * A `ListRow` sizes its own text column to what is in it, so a slot inside one
 * has to carry a width rather than a fraction of a width — a percentage of a
 * shrink-to-fit box resolves to nothing, and the row came out empty.
 */
const FACT_ROWS = [
  { id: 'one', name: 'w-64', fact: 'w-40' },
  { id: 'two', name: 'w-48', fact: 'w-32' },
  { id: 'three', name: 'w-56', fact: 'w-36' },
  { id: 'four', name: 'w-40', fact: 'w-28' },
  { id: 'five', name: 'w-60', fact: 'w-44' },
  { id: 'six', name: 'w-44', fact: 'w-32' },
] as const

/**
 * The settled facts a settings section lists, on their way: a name, what is
 * known about it, and the verb that undoes it. Drawn with the same `ListRow` the
 * answer will be, so nothing moves when it lands.
 */
export function SkeletonFacts({
  rows = 3,
  className,
}: {
  readonly rows?: 2 | 3 | 4 | 5 | 6
  readonly className?: string
}) {
  return (
    <ul className={cn('space-y-3', className)}>
      {FACT_ROWS.slice(0, rows).map((row) => (
        <ListRow
          key={row.id}
          primary={<Skeleton className={cn('h-3 max-w-full', row.name)} />}
          secondary={<Skeleton className={cn('mt-2 h-2 max-w-full', row.fact)} />}
          action={<Skeleton className="h-9 w-24 rounded-lg" />}
        />
      ))}
    </ul>
  )
}

/** The sentence without the ellipsis it was written with — the timed one replaces it. */
function stripEllipsis(sentence: string): string {
  return sentence.replace(/\s*(…|\.\.\.)$/, '')
}

interface WorkingProps {
  /** The wait as it is written everywhere else, trailing ellipsis and all. */
  readonly children: string
  readonly className?: string
}

/**
 * A wait said in words, for the places too small to hold a shape: a line under a
 * control, a record expanding inside a thread. The sentence is the one the call
 * site wrote; what this adds is that its last three characters keep time, which
 * is the difference between a pane that is working and a pane that stopped
 * mid-sentence.
 */
export function Working({ children, className }: WorkingProps) {
  return (
    <span className={cn('inline-flex items-baseline', className)}>
      {stripEllipsis(children)}

      <span aria-hidden="true" className="inline-flex">
        <span className="working-dot">.</span>
        <span className="working-dot">.</span>
        <span className="working-dot">.</span>
      </span>
    </span>
  )
}
