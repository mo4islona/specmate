import type { ComponentPropsWithRef } from 'react'
import { cn } from './cn.ts'

interface ChipProps extends ComponentPropsWithRef<'button'> {
  /** One of a set, chosen. */
  readonly pressed?: boolean
  /** Holds something open — a menu, a note. */
  readonly expanded?: boolean
}

/**
 * Something to pick: an offered answer, a size, a document on a step's shelf.
 * Both states are read off ARIA rather than out of a class, so the styling and
 * what a screen reader is told can never disagree.
 */
export function Chip({ pressed, expanded, className, children, ...rest }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-expanded={expanded}
      className={cn('chip', className)}
      {...rest}
    >
      {children}
    </button>
  )
}
