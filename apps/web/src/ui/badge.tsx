import { cva, type VariantProps } from 'class-variance-authority'
import type { HTMLAttributes } from 'react'
import { cn } from './cn.ts'

/**
 * A tone worn as a word rather than a control: a status, a size, a gap.
 *
 * The pill is cut into the page rather than laid over it. A wash of the tone
 * composited on the panel moves the background *toward* the word written on it,
 * which in a dark theme is the wrong direction — it is what left a stopped badge
 * at 3.3:1. Mixing the same tone into the ground keeps the pill darker than the
 * surface it sits on, and the word keeps its colour.
 *
 * Each tone therefore says only which colour it is, once, and the base rule uses
 * it twice. Six tones spelling out both would be twelve chances to write the
 * pair the wrong way round.
 */
const badgeVariants = cva(
  'inline-flex max-w-full items-center rounded-full px-[0.6rem] py-[0.15rem] font-mono text-[0.68rem] leading-[1.45] bg-[color-mix(in_srgb,var(--badge-tone)_8%,var(--color-background))] text-[var(--badge-tone)]',
  {
    variants: {
      tone: {
        active: '[--badge-tone:var(--color-status-active)]',
        parked: '[--badge-tone:var(--color-status-parked)]',
        failed: '[--badge-tone:var(--color-status-failed)]',
        done: '[--badge-tone:var(--color-status-done)]',
        muted: '[--badge-tone:var(--color-muted-foreground)]',
        warning: '[--badge-tone:var(--color-warning)]',
      },
    },
    defaultVariants: { tone: 'muted' },
  },
)

/**
 * The small, shared vocabulary a badge can carry. It is about where something
 * stands, not what colour it is — which theme paints `parked` amber is the
 * theme's business.
 */
export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>['tone']>

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  readonly tone?: BadgeTone
}

export function Badge({ tone = 'muted', className, children, ...rest }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...rest}>
      {children}
    </span>
  )
}
