import type { ComponentPropsWithRef } from 'react'
import { cn } from './cn.ts'

interface ChipProps extends ComponentPropsWithRef<'button'> {
  /** One of a set, chosen. */
  readonly pressed?: boolean
  /** Holds something open — a menu, a note. */
  readonly expanded?: boolean
}

/**
 * Held open, and one of a set chosen: both are where the pointer has been, not
 * states of the work, so both press into the surface rather than colour it.
 */
const CHIP = [
  'inline-flex min-h-[2rem] items-center gap-[0.4rem] rounded-[0.625rem] text-start',
  'border border-[color-mix(in_srgb,var(--color-border-strong)_55%,transparent)]',
  'bg-[color-mix(in_srgb,var(--color-foreground)_3%,transparent)] px-[0.75rem] py-[0.35rem]',
  'font-mono text-[0.73rem]/[1.35] text-foreground',
  'transition-[background-color,border-color,color] duration-[120ms] ease-[ease]',
  'not-disabled:hover:border-border-strong not-disabled:hover:bg-[color-mix(in_srgb,var(--color-foreground)_6%,transparent)]',
  'aria-expanded:border-border-strong aria-expanded:bg-[color-mix(in_srgb,var(--color-foreground)_11%,transparent)]',
  'aria-pressed:border-border-strong aria-pressed:bg-[color-mix(in_srgb,var(--color-foreground)_11%,transparent)] aria-pressed:font-semibold',
  'disabled:cursor-not-allowed disabled:opacity-[0.38]',
].join(' ')

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
      className={cn(CHIP, className)}
      {...rest}
    >
      {children}
    </button>
  )
}
