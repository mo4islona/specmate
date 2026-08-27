import { cx } from './cx.ts'
import { Skeleton, SkeletonRows, SkeletonText, Waiting, Working } from './loading.tsx'
import { EmptyState, MicroLabel, Note } from './note.tsx'
import { Panel } from './panel.tsx'

/**
 * The shape the answer is going to take. A pane that waits as a grey box and
 * then snaps into a two-column grid of cards moves the page under whoever was
 * looking at it; a pane that waits in the shape of its own answer does not, and
 * it says what is coming while it says that something is.
 */
export type WaitShape =
  /** No shape worth guessing at — say it in words. */
  | 'sentence'
  /** A rail or a list: a name over a fact, down a column. */
  | 'rows'
  /** The inbox: panels of their own, two across where there is room. */
  | 'cards'
  /** Prose under a heading — a stored document, a task's thread. */
  | 'document'
  /** A diff, which is lines of code rather than lines of prose. */
  | 'code'

/** A diff's lines keep the ragged, indented shape code has. */
const CODE_LINES = [
  { id: 'one', width: 'w-1/3' },
  { id: 'two', width: 'w-3/4' },
  { id: 'three', width: 'w-2/3' },
  { id: 'four', width: 'w-5/6' },
  { id: 'five', width: 'w-2/5' },
  { id: 'six', width: 'w-3/5' },
  { id: 'seven', width: 'w-4/5' },
  { id: 'eight', width: 'w-1/2' },
] as const

const CARDS = ['one', 'two', 'three', 'four'] as const

function WaitingCard({ lines }: { readonly lines: 1 | 2 }) {
  return (
    <Panel as="div">
      <Skeleton className="h-2 w-24" />
      <Skeleton className="mt-3 h-4 w-3/5" />
      <SkeletonText lines={lines} className="mt-4" />

      <div className="mt-5 flex items-center justify-between gap-3">
        <Skeleton className="h-4 w-20 rounded-full" />
        <Skeleton className="h-2 w-16" />
      </div>
    </Panel>
  )
}

function WaitingShape({ shape }: { readonly shape: Exclude<WaitShape, 'sentence'> }) {
  if (shape === 'rows') {
    return (
      <Panel as="div">
        <SkeletonRows rows={6} />
      </Panel>
    )
  }

  if (shape === 'cards') {
    return (
      <div className="grid gap-3 xl:grid-cols-2">
        {CARDS.map((card, index) => (
          <WaitingCard key={card} lines={index % 2 === 0 ? 2 : 1} />
        ))}
      </div>
    )
  }

  if (shape === 'code') {
    return (
      <Panel as="div" flush>
        <div className="space-y-2 p-4 sm:p-6">
          {CODE_LINES.map((line) => (
            <Skeleton key={line.id} className={cx('h-2.5', line.width)} />
          ))}
        </div>
      </Panel>
    )
  }

  return (
    <Panel as="div" flush>
      <div className="border-b border-border px-4 py-3 sm:px-6">
        <Skeleton className="h-2.5 w-1/3" />
      </div>

      <div className="space-y-7 p-4 sm:p-6">
        <SkeletonText lines={4} />
        <SkeletonText lines={3} />
        <SkeletonText lines={5} />
      </div>
    </Panel>
  )
}

interface LoadingStateProps {
  /** What is being waited on, as a sentence. It is what a screen reader is told. */
  readonly title: string
  readonly shape?: WaitShape
  readonly className?: string
}

/**
 * A pane waiting on its request, at the size and in the shape the answer will
 * take. `aria-busy` and the one sentence are what carry the wait to anyone not
 * looking at it — the slots themselves are hidden, being furniture.
 */
export function LoadingState({ title, shape = 'sentence', className }: LoadingStateProps) {
  if (shape === 'sentence') {
    return (
      <Panel as="div" flush role="status" aria-busy="true" className={className}>
        <EmptyState mono>
          <Working>{title}</Working>
        </EmptyState>
      </Panel>
    )
  }

  return (
    <Waiting label={title} className={className}>
      <WaitingShape shape={shape} />
    </Waiting>
  )
}

interface ErrorStateProps {
  readonly title: string
  readonly detail?: string
}

/** A request that will not be answered, and what the server said about it. */
export function ErrorState({ title, detail }: ErrorStateProps) {
  return (
    <Panel as="div" className="border-destructive/35">
      <MicroLabel tone="destructive">Request failed</MicroLabel>

      <h2 className="mt-2 text-lg font-semibold">{title}</h2>

      {detail && <Note className="mt-2">{detail}</Note>}
    </Panel>
  )
}
