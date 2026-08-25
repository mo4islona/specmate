import type { ComponentPropsWithRef, ReactNode } from 'react'
import { Link } from 'wouter'
import { cx } from './cx.ts'
import { Dot } from './note.tsx'

/**
 * Five weights and nothing else — the verb that acts, the same verb when the
 * task is waiting on this click, the one that undoes, the alternative, and the
 * quiet one. `ghost-danger` is the quiet one in the colour of the thing it
 * undoes; it is a modifier on `ghost` rather than a sixth weight.
 */
export type ButtonVariant =
  | 'primary'
  | 'attention'
  | 'danger'
  | 'secondary'
  | 'ghost'
  | 'ghost-danger'

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'button-primary',
  attention: 'button-attention',
  danger: 'button-danger',
  secondary: 'button-secondary',
  ghost: 'button-ghost',
  'ghost-danger': 'button-ghost button-ghost-danger',
}

/**
 * For the two things that wear a button and are not one: a `<summary>`, which
 * has to stay a summary for the disclosure to work, and a verb whose cap is
 * spent, which reports rather than acts.
 */
export function buttonClass(variant: ButtonVariant): string {
  return VARIANT[variant]
}

interface ButtonProps extends ComponentPropsWithRef<'button'> {
  readonly variant?: ButtonVariant
  /**
   * The click is in flight. The button goes disabled and says so, which is the
   * `isPending ? 'Saving…' : 'Save'` every call site used to write out.
   */
  readonly pending?: boolean
  readonly pendingLabel?: ReactNode
}

export function Button({
  variant = 'secondary',
  pending = false,
  pendingLabel,
  disabled = false,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const label = pending && pendingLabel !== undefined ? pendingLabel : children

  return (
    <button
      type={type}
      className={cx(VARIANT[variant], className)}
      disabled={disabled || pending}
      // What tells a verb waiting on the server from a verb you cannot use: it
      // is what lifts the 38% back off, and it is the honest word for the state.
      aria-busy={pending || undefined}
      {...rest}
    >
      {/* The label already says `Saving…`; the mark is what says it is still
          true. `currentColor`, so it works on the accent and on the ghost. */}
      {pending && <Dot live className="bg-current" />}

      {label}
    </button>
  )
}

interface ButtonLinkProps {
  readonly href: string
  readonly variant?: ButtonVariant
  readonly className?: string
  readonly children: ReactNode
  readonly 'aria-current'?: 'page'
  readonly 'aria-label'?: string
}

/** A button that navigates. Same weights, so a launch reads the same anywhere. */
export function ButtonLink({
  href,
  variant = 'secondary',
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  return (
    <Link href={href} className={cx(VARIANT[variant], className)} {...rest}>
      {children}
    </Link>
  )
}
