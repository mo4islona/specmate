import type { ReactNode } from 'react'
import { Link } from 'wouter'
import { cx } from './cx.ts'

interface QuietLinkProps {
  readonly href: string
  readonly className?: string
  readonly children: ReactNode
}

/**
 * A way out of where you are, not a verb of it: readable, and quieter than a
 * button. It is the same weight as the text it sits in and carries a rule under
 * it so it still reads as somewhere to go.
 */
export function QuietLink({ href, className, children }: QuietLinkProps) {
  return (
    <Link href={href} className={cx('link-quiet', className)}>
      {children}
    </Link>
  )
}

interface InlineLinkProps {
  readonly href: string
  readonly className?: string
  readonly children: ReactNode
}

/** A link inside a sentence — the task a waiver came from, the task this one waits on. */
export function InlineLink({ href, className, children }: InlineLinkProps) {
  return (
    <Link href={href} className={cx('text-info underline-offset-4 hover:underline', className)}>
      {children}
    </Link>
  )
}
