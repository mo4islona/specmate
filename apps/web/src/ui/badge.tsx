import type { HTMLAttributes } from 'react'
import { cx } from './cx.ts'

/**
 * The small, shared vocabulary a badge can carry. It is about where something
 * stands, not what colour it is — which theme paints `parked` amber is the
 * theme's business.
 */
export type BadgeTone = 'active' | 'parked' | 'failed' | 'done' | 'muted' | 'warning'

const TONE: Record<BadgeTone, string> = {
  active: 'badge-active',
  parked: 'badge-parked',
  failed: 'badge-failed',
  done: 'badge-done',
  muted: 'badge-muted',
  warning: 'badge-warning',
}

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  readonly tone?: BadgeTone
}

/** A tone worn as a word rather than a control: a status, a size, a gap. */
export function Badge({ tone = 'muted', className, children, ...rest }: BadgeProps) {
  return (
    <span className={cx('badge', TONE[tone], className)} {...rest}>
      {children}
    </span>
  )
}
