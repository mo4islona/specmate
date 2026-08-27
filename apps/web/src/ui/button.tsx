import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentPropsWithRef, ReactNode } from 'react'
import { Link } from 'wouter'
import { cn } from './cn.ts'
import { Dot } from './note.tsx'

/**
 * shadcn's button, kept as close to the upstream table as this app's palette
 * allows. Two variants are ours because shadcn has no word for them: `warning`,
 * the colour this app uses for "your turn", and `ghost-destructive`, the quiet
 * verb in the colour of the thing it undoes.
 *
 * Two other departures, both deliberate:
 *
 * Upstream's `destructive` writes `text-white`. Here it names the role, so the
 * word on a red button is whatever the theme says reads on one — four of the
 * nine palettes would otherwise put white on a red that is nearly as light.
 *
 * Upstream also sizes every icon inside a button to `size-4`. `Icon` sets its
 * size as an attribute rather than a class, so that rule would catch all of them
 * and flatten a scale of five to one. It is the only line of the base left out.
 */
export const buttonVariants = cva(
  [
    'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap',
    'rounded-md text-sm font-medium transition-all',
    'disabled:pointer-events-none disabled:opacity-50',
    'outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
    'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
  ].join(' '),
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
        warning: 'bg-warning text-warning-foreground shadow-xs hover:bg-warning/90',
        destructive:
          'bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20',
        outline: 'border border-input bg-background shadow-xs hover:bg-accent',
        secondary: 'bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        'ghost-destructive': 'text-destructive hover:bg-destructive/10 hover:text-destructive',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3',
        sm: 'h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5',
        lg: 'h-10 rounded-md px-6 has-[>svg]:px-4',
        icon: 'size-9',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'default' },
  },
)

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>['variant']>
export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>['size']>

interface ButtonProps extends ComponentPropsWithRef<'button'> {
  readonly variant?: ButtonVariant
  readonly size?: ButtonSize
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
 * wearing the second one's fade — which is where the breathing mark beside its
 * label went. Written as the same `disabled:` utility so `cn` settles the pair.
 */
const PENDING = 'disabled:opacity-70'

export function Button({
  variant = 'secondary',
  size = 'default',
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
      className={cn(buttonVariants({ variant, size }), pending && PENDING, className)}
      disabled={disabled || pending}
      // What tells a verb waiting on the server from a verb you cannot use, and
      // it is the honest word for the state.
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
  readonly variant?: ButtonVariant
  readonly size?: ButtonSize
}

/**
 * A verb drawn rather than written, for the controls that sit over what they
 * act on: a row of words under every edit in a step was more of the record than
 * the record. The label is never optional — a glyph nobody can name is a guess.
 *
 * It is `Button` at the square size; what it adds is that the name is required.
 */
export function IconButton({
  label,
  variant = 'ghost',
  size = 'icon',
  className,
  children,
  ...rest
}: IconButtonProps) {
  return (
    <Button
      variant={variant}
      size={size}
      aria-label={label}
      title={label}
      className={className}
      {...rest}
    >
      {children}
    </Button>
  )
}

interface ButtonLinkProps {
  readonly href: string
  readonly variant?: ButtonVariant
  readonly size?: ButtonSize
  readonly className?: string
  readonly children: ReactNode
  readonly 'aria-current'?: 'page'
  readonly 'aria-label'?: string
}

/** A button that navigates. Same weights, so a launch reads the same anywhere. */
export function ButtonLink({
  href,
  variant = 'secondary',
  size = 'default',
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  return (
    <Link href={href} className={cn(buttonVariants({ variant, size }), className)} {...rest}>
      {children}
    </Link>
  )
}
