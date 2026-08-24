import { type ReactNode, useEffect, useRef } from 'react'
import { cx } from './cx.ts'

export type PopoverSide = 'top' | 'bottom'

const SIDE: Record<PopoverSide, string> = {
  top: 'bottom-full mb-2',
  bottom: 'top-full mt-2',
}

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
 * Something opened over the page, and the two ways out of it that every one of
 * them needs: click past it, or press Escape. Three of these were written by
 * hand at three widths, two z-indexes and two paddings, and only one of the
 * three could be dismissed without answering it.
 *
 * It is deliberately not a positioning engine. Every popover in this app opens
 * off a control in normal flow, so the anchor is the wrapper and the only
 * choice is which side of it — above, where a console's control row sits at the
 * foot of the screen, or below, where a picker sits at the top of a form.
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
  const root = useRef<HTMLDivElement | null>(null)
  // The listeners are bound once per open, not once per render: `onDismiss` is
  // rebuilt by every parent render, and binding on its identity re-subscribes
  // the document on each one.
  const dismiss = useRef(onDismiss)

  useEffect(() => {
    dismiss.current = onDismiss
  })

  useEffect(() => {
    if (!open) return

    function onPointerDown(event: PointerEvent): void {
      if (!root.current?.contains(event.target as Node)) dismiss.current()
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') dismiss.current()
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={root} className="relative">
      {trigger}

      {open && (
        // Above the sticky headers, which sit at 20 — a popover that opens
        // behind the bar it was opened from is a popover nobody can read.
        <div
          {...aria}
          style={{ width }}
          className={cx('popover absolute left-0 z-30', SIDE[side], PADDING[padding])}
        >
          {children}
        </div>
      )}
    </div>
  )
}
