import * as DialogPrimitive from '@radix-ui/react-dialog'
import type { ReactNode } from 'react'
import { Button } from './button.tsx'
import { cn } from './cn.ts'
import { Icon } from './icon.tsx'

interface DrawerProps {
  readonly open: boolean
  readonly onDismiss: () => void
  /** Names the layer, and titles it where a heading is wanted. */
  readonly label: string
  /** Beside the label — the path being read, what the layer is about. */
  readonly detail?: ReactNode
  /** Its own width, because a drawer is not as wide as what it covers. */
  readonly width?: string
  readonly className?: string
  readonly children: ReactNode
}

/**
 * A surface that opens over the one being read rather than instead of it. A
 * route would put a back button between a person and the thread they were in
 * the middle of; a layer closes back onto it, at the scroll position it left.
 *
 * A dialog rather than a box with a key listener, which is what it was: Radix
 * traps the tab ring inside it, locks the page behind it, and hands the focus
 * back to whatever opened it. A layer you can tab out of into the record it is
 * covering is a layer a keyboard cannot tell it is in.
 */
export function Drawer({
  open,
  onDismiss,
  label,
  detail,
  width = 'min(56rem, 92vw)',
  className,
  children,
}: DrawerProps) {
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onDismiss()
      }}
    >
      <DialogPrimitive.Portal>
        {/* Dims what the drawer covers without hiding it: the surface underneath
            is what the drawer is about, and reading the two together is the
            point. */}
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-40 bg-[color-mix(in_srgb,var(--color-background)_75%,transparent)] backdrop-blur-[1px]',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
          )}
        />

        <DialogPrimitive.Content
          style={{ width }}
          className={cn(
            'fixed inset-y-0 end-0 z-40 flex h-full min-w-0 flex-col',
            'border-s border-border-strong bg-card shadow-[var(--shadow-popover)]',
            'data-[state=open]:animate-in data-[state=open]:slide-in-from-right',
            'data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right',
            className,
          )}
        >
          <header className="flex items-start justify-between gap-4 border-b border-border px-4 py-3 sm:px-6">
            <div className="min-w-0">
              {/* The title is the layer's name to a screen reader as well as its
                  eyebrow on screen, so it is one element rather than an
                  `aria-label` repeating what is already written. */}
              <DialogPrimitive.Title className="font-mono text-[0.68rem] font-semibold uppercase leading-tight tracking-[0.16em] text-muted-foreground">
                {label}
              </DialogPrimitive.Title>
              {detail}
            </div>

            <DialogPrimitive.Close asChild>
              <Button variant="ghost" aria-label={`Close ${label.toLowerCase()}`}>
                <Icon name="close" size="xs" />
                close
              </Button>
            </DialogPrimitive.Close>
          </header>

          <div className="scroll-thin min-h-0 min-w-0 flex-1 overflow-auto">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
