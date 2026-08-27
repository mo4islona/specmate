import * as PopoverPrimitive from '@radix-ui/react-popover'
import type { ReactNode } from 'react'
import { cn } from './cn.ts'

export type PopoverSide = 'top' | 'bottom'

const PADDING = {
  /** Prose and a verb under it — a confirmation, a rework target. */
  content: 'p-3.5',
  /** Rows that carry their own inset. */
  menu: 'p-1.5',
} as const

interface PopoverProps {
  readonly open: boolean
  readonly onDismiss: () => void
  /** Whatever opens it, rendered in place — the popover only owns the box. */
  readonly trigger: ReactNode
  readonly side?: PopoverSide
  /** Its own width: a popover is not as wide as the control that opened it. */
  readonly width?: string
  readonly padding?: keyof typeof PADDING
  readonly role?: 'menu' | 'dialog'
  readonly label?: string
  readonly children: ReactNode
}

/**
 * Anything that opens over the page — a rework target, a confirmation, a menu.
 * One surface for all of them, and the lifted one: a popover is by definition
 * above whatever it covers, and half of them cover the console, which already
 * sits on that surface.
 *
 * The two ways out that every one of them needs — click past it, or press
 * Escape — are Radix's now. Three of these were written by hand at three widths,
 * two z-indexes and two paddings, and only one of the three could be dismissed
 * without answering it.
 *
 * The trigger is an `Anchor` rather than a `Trigger`: every call site already
 * owns the open state and toggles it on its own control, and a `Trigger` would
 * toggle it a second time on the same click.
 */
export function Popover({
  open,
  onDismiss,
  trigger,
  side = 'top',
  width = '21rem',
  padding = 'content',
  role,
  label,
  children,
}: PopoverProps) {
  // The role and the name it needs travel together: a bare `aria-label` on a
  // `div` with no role names nothing.
  const aria = role ? { role, 'aria-label': label } : {}

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onDismiss()
      }}
    >
      <PopoverPrimitive.Anchor className="relative">{trigger}</PopoverPrimitive.Anchor>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          {...aria}
          side={side}
          align="start"
          sideOffset={8}
          collisionPadding={8}
          style={{ width }}
          // Radix returns the focus to the anchor on close, which is what a
          // keyboard needs; it also focuses the content on open, which for a
          // menu of rows is right and for a confirmation is where the verb is.
          className={cn(
            'z-50 rounded-xl border border-border-strong bg-popover shadow-[var(--shadow-popover)]',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
            PADDING[padding],
          )}
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
