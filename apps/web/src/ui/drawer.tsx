import { type ReactNode, useEffect, useRef } from 'react'
import { Button } from './button.tsx'
import { cx } from './cx.ts'
import { MicroLabel } from './note.tsx'

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
 * The two ways out every layer needs are here, as they are on a popover: press
 * Escape, or click past it. The difference is scale — a popover is anchored to
 * the control that opened it and a drawer is anchored to the viewport, because
 * what opens one is a file named halfway down a record, not a control with room
 * beneath it.
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
  // The listener is bound once per open, not once per render: `onDismiss` is
  // rebuilt by every parent render, and binding on its identity re-subscribes
  // the document on each one.
  const dismiss = useRef(onDismiss)

  useEffect(() => {
    dismiss.current = onDismiss
  })

  useEffect(() => {
    if (!open) return

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') dismiss.current()
    }

    document.addEventListener('keydown', onKeyDown)

    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      {/* Clicking away is a pointer affordance, not a control: the close button
          and Escape are what assistive technology is offered. */}
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onDismiss}
        className="drawer-scrim absolute inset-0"
      />

      <section
        role="dialog"
        aria-modal="true"
        aria-label={label}
        style={{ width }}
        className={cx('drawer relative flex h-full min-w-0 flex-col', className)}
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <MicroLabel>{label}</MicroLabel>
            {detail}
          </div>

          <Button variant="ghost" onClick={onDismiss} aria-label={`Close ${label.toLowerCase()}`}>
            ✕ close
          </Button>
        </header>

        <div className="scroll-thin min-h-0 min-w-0 flex-1 overflow-auto">{children}</div>
      </section>
    </div>
  )
}
