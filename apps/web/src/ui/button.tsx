import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentPropsWithRef, ReactNode } from 'react'
import { Link } from 'wouter'
import { cn } from './cn.ts'
import { Dot } from './note.tsx'

/**
 * Five weights and nothing else — the verb that acts, the same verb when the
 * task is waiting on this click, the one that undoes, the alternative, and the
 * quiet one. `ghost-destructive` is the quiet one in the colour of the thing it
 * undoes; it is a modifier on `ghost` rather than a sixth weight.
 *
 * A weight carries its own metrics rather than taking a `size` beside it, which
 * is a departure from shadcn: `ghost` is shorter and lighter than the four solid
 * ones, and always has been. Splitting the two apart would be an improvement to
 * make deliberately, on its own, looking at the twenty-odd rows a ghost button
 * sits in — not as a side effect of changing what it is written in.
 */
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-[0.4rem] rounded-lg font-mono transition-[background-color,border-color,color] duration-[120ms] ease-[ease] disabled:cursor-not-allowed disabled:opacity-[0.38]',
  {
    variants: {
      variant: {
        primary:
          'min-h-[2.4rem] border border-transparent px-[0.95rem] py-2 text-xs/[1.25] font-bold bg-primary text-primary-foreground not-disabled:hover:bg-[color-mix(in_srgb,var(--color-primary)_84%,var(--color-hover-tint))]',
        // A state waiting on the owner wears the colour the rest of the screen
        // uses for "your turn" — never the red of the thing that went wrong.
        warning:
          'min-h-[2.4rem] border border-transparent px-[0.95rem] py-2 text-xs/[1.25] font-bold bg-warning text-warning-foreground not-disabled:hover:bg-[color-mix(in_srgb,var(--color-warning)_84%,var(--color-hover-tint))]',
        destructive:
          'min-h-[2.4rem] border border-transparent px-[0.95rem] py-2 text-xs/[1.25] font-bold bg-destructive text-destructive-foreground not-disabled:hover:bg-[color-mix(in_srgb,var(--color-destructive)_84%,var(--color-hover-tint))]',
        secondary:
          'min-h-[2.4rem] border px-[0.95rem] py-2 text-xs/[1.25] font-bold border-[color-mix(in_srgb,var(--color-border-strong)_70%,transparent)] bg-secondary text-secondary-foreground not-disabled:hover:border-border-strong not-disabled:hover:bg-[color-mix(in_srgb,var(--color-foreground)_9%,transparent)]',
        // No frame until you point at it: a hover border on every quiet control
        // is what made a row of them read as a toolbar.
        ghost:
          'min-h-[1.95rem] border-0 px-[0.65rem] py-[0.3rem] text-[0.72rem]/[1.25] text-muted-foreground not-disabled:hover:bg-accent not-disabled:hover:text-accent-foreground',
        'ghost-destructive':
          'min-h-[1.95rem] border-0 px-[0.65rem] py-[0.3rem] text-[0.72rem]/[1.25] text-destructive not-disabled:hover:bg-[color-mix(in_srgb,var(--color-destructive)_14%,transparent)] not-disabled:hover:text-destructive',
      },
    },
    defaultVariants: { variant: 'secondary' },
  },
)

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>['variant']>

interface ButtonProps extends ComponentPropsWithRef<'button'> {
  readonly variant?: ButtonVariant
  /**
   * The click is in flight. The button goes disabled and says so, which is the
   * `isPending ? 'Saving…' : 'Save'` every call site used to write out.
   */
  readonly pending?: boolean
  readonly pendingLabel?: ReactNode
  /** Render the child as the button, for the things that wear one and are not one. */
  readonly asChild?: boolean
}

/**
 * Waiting on the server is not the same as unavailable, and a verb in flight was
 * wearing the second one's 38% — which is where the breathing mark beside its
 * label went. Written as the same `disabled:` pair rather than an `aria-busy:`
 * one so `cn` can settle them: two utilities under different variants both
 * apply, and which of those wins is Tailwind's emission order rather than ours.
 */
const PENDING = 'disabled:cursor-progress disabled:opacity-[0.68]'

export function Button({
  variant = 'secondary',
  pending = false,
  pendingLabel,
  disabled = false,
  asChild = false,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const label = pending && pendingLabel !== undefined ? pendingLabel : children
  const Tag = asChild ? Slot : 'button'

  return (
    <Tag
      type={type}
      className={cn(buttonVariants({ variant }), pending && PENDING, className)}
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
    </Tag>
  )
}

interface IconButtonProps extends ComponentPropsWithRef<'button'> {
  /** The word the glyph stands for. It is the button's whole accessible name. */
  readonly label: string
}

/**
 * A verb drawn rather than written, for the controls that sit over what they
 * act on: a row of words under every edit in a step was more of the record than
 * the record. The label is never optional — a glyph nobody can name is a guess.
 *
 * It carries its own ground, because the thing under it is usually code and an
 * unbacked glyph on code is neither.
 */
export function IconButton({
  label,
  className,
  children,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex h-[1.55rem] w-[1.55rem] items-center justify-center rounded-[0.45rem] border-0 text-muted-foreground transition-[background-color,color] duration-[120ms] ease-[ease]',
        'bg-[color-mix(in_srgb,var(--color-popover)_90%,transparent)] not-disabled:hover:bg-popover not-disabled:hover:text-foreground',
        'disabled:cursor-not-allowed disabled:opacity-[0.38]',
        className,
      )}
      {...rest}
    >
      {children}
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
    <Link href={href} className={cn(buttonVariants({ variant }), className)} {...rest}>
      {children}
    </Link>
  )
}
