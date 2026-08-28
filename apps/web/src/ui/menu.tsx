import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentPropsWithRef, ReactNode } from 'react'
import { cn } from './cn.ts'

/**
 * A row of a popover menu. The inset is the part's, not the caller's: three
 * menus wrote three of them — a `Button` at its form height inside a `p-1.5`
 * box, a hand-rolled row at `px-2.5 py-2`, and a third copy of that on the
 * workbench — so the same menu read as a different control depending on which
 * screen opened it.
 *
 * `px-2.5` against the menu's own `p-1.5` puts every label a gutter in from the
 * popover's edge, which is what the corner radius wants.
 */
const menuItem = cva(
  [
    'flex w-full gap-3 rounded-lg px-2.5 text-left text-sm transition-colors',
    'outline-none focus-visible:bg-foreground/[0.06]',
    'disabled:pointer-events-none disabled:opacity-50',
  ].join(' '),
  {
    variants: {
      tone: {
        default: 'text-foreground hover:bg-foreground/[0.06]',
        destructive: 'text-destructive hover:bg-destructive/10',
      },
      /** A verb on one line, or a value with what it means under it. */
      shape: {
        row: 'items-center py-1.5',
        stack: 'items-start py-2',
      },
    },
    defaultVariants: { tone: 'default', shape: 'row' },
  },
)

export type MenuItemTone = NonNullable<VariantProps<typeof menuItem>['tone']>
export type MenuItemShape = NonNullable<VariantProps<typeof menuItem>['shape']>

interface MenuItemProps extends ComponentPropsWithRef<'button'> {
  readonly tone?: MenuItemTone
  readonly shape?: MenuItemShape
  /** Held at the trailing edge — the tick on the row that is chosen. */
  readonly trailing?: ReactNode
}

export function MenuItem({
  tone,
  shape,
  trailing,
  role = 'menuitem',
  className,
  children,
  ...rest
}: MenuItemProps) {
  return (
    <button
      type="button"
      role={role}
      className={cn(menuItem({ tone, shape }), className)}
      {...rest}
    >
      <span className="min-w-0 flex-1">{children}</span>

      {trailing}
    </button>
  )
}

/**
 * What holds a destructive verb apart from the ones above it. It reaches back
 * over the menu's padding on both sides, because a rule that stops short of the
 * box's edge reads as a stray line rather than a division.
 */
export function MenuSeparator({ className }: { readonly className?: string }) {
  return <hr className={cn('-mx-1.5 my-1.5 border-border', className)} />
}
