import type { HTMLAttributes, ReactNode } from 'react'
import { Link } from 'wouter'
import { cx } from './cx.ts'
import { Subpanel } from './panel.tsx'

interface ListRowProps {
  /** What the row is — a repository URL, a path. */
  readonly primary: ReactNode
  /** What is known about it, under the name. */
  readonly secondary?: ReactNode
  /** The one verb the row offers, held at its trailing edge. */
  readonly action?: ReactNode
  readonly className?: string
}

/** A settled fact with a way to undo it: a waiver, a convention, a binding. */
export function ListRow({ primary, secondary, action, className }: ListRowProps) {
  return (
    <Subpanel as="li" className={cx('flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        {primary}
        {secondary}
      </div>

      {action}
    </Subpanel>
  )
}

/**
 * A folder in a tree of files. Quieter than the group headings it sits under —
 * drawn at their weight, a tree reads as a flat column with no hierarchy in it.
 */
export function FolderName({ className, children, ...rest }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cx('tree-folder', className)} {...rest}>
      {children}
    </p>
  )
}

const ROW_BASE = 'rail-row rounded-lg py-2 transition-colors'
// Where you are, not how the thing is going. A tinted wash under a row claimed a
// state the row's own dot was busy contradicting.
const ROW_ON = 'bg-foreground/[0.09] text-foreground'
const ROW_OFF = 'text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground'

interface NavRowProps {
  /** A link when the row goes somewhere addressable, a button when it only selects. */
  readonly href?: string
  readonly active: boolean
  readonly onClick?: () => void
  readonly title?: string
  readonly className?: string
  readonly children: ReactNode
}

/**
 * One row of a rail — a task, a document, a changed file, the way to Settings.
 * It reaches half a gutter past the rail's inset on either side so pointing at
 * it has an edge to show, and its text still starts on that inset.
 *
 * Only the box and the two states are here; what goes inside is the caller's,
 * because a task row is a dot beside two lines and a file row is a path above a
 * pair of counts.
 */
export function NavRow({ href, active, onClick, title, className, children }: NavRowProps) {
  const classes = cx(ROW_BASE, active ? ROW_ON : ROW_OFF, className)

  if (href !== undefined) {
    return (
      <Link
        href={href}
        aria-current={active ? 'page' : undefined}
        title={title}
        className={classes}
        onClick={onClick}
      >
        {children}
      </Link>
    )
  }

  return (
    <button
      type="button"
      aria-pressed={active}
      title={title}
      className={cx(classes, 'w-full text-left')}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
