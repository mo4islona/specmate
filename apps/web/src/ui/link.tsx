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

/**
 * A link inside a sentence — the task a waiver came from, the task this one
 * waits on. It carries its rule at all times rather than a colour: the sentence
 * around it is already the reading tone, and a hue in the middle of one reads as
 * emphasis on the word rather than as somewhere to go.
 */
export function InlineLink({ href, className, children }: InlineLinkProps) {
  return (
    <Link
      href={href}
      className={cx(
        'underline decoration-border-bright underline-offset-4 hover:decoration-current',
        className,
      )}
    >
      {children}
    </Link>
  )
}
