import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface HoverHintProps {
  readonly hint: ReactNode
  /** How long the pointer must rest before the hint appears. */
  readonly delayMs?: number
  readonly children: ReactNode
}

interface Placement {
  readonly top: number
  readonly left: number
}

const WIDTH = 300
const GAP = 10
const EDGE = 8

/**
 * A hint that waits to be asked for. The browser's own `title` needs about a
 * second and then draws an operating-system box in the wrong font; this reads
 * as part of the interface and appears on the same beat.
 *
 * It waits deliberately: a rail of ten rows whose hints fire instantly is a
 * screen that flickers whenever the pointer crosses it on the way somewhere
 * else. Focus shows it at once, because arriving by keyboard is already
 * deliberate.
 *
 * It is drawn into the document body rather than beside what it describes. The
 * rail it lives in is a scrolling column with a border, and every one of those
 * clips an absolutely-positioned child — the hint was being cut off on every
 * side at once. Fixed coordinates measured from the trigger are the only
 * placement that no ancestor can crop.
 */
export function HoverHint({ hint, delayMs = 550, children }: HoverHintProps) {
  const [placement, setPlacement] = useState<Placement | null>(null)
  const anchor = useRef<HTMLSpanElement | null>(null)
  const bubble = useRef<HTMLSpanElement | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // The ref is the stable thing here; the handlers below are rebuilt every
  // render, so unmounting reads the timer directly rather than through them.
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )

  // The first placement is computed without knowing how tall the hint turned
  // out to be; this is the correction, before the browser paints it.
  useLayoutEffect(() => {
    const node = bubble.current
    if (!node || !placement) return

    const height = node.offsetHeight
    const room = window.innerHeight - EDGE - height
    const clamped = Math.max(EDGE, Math.min(placement.top, room))
    if (clamped !== placement.top)
      setPlacement({ ...placement, left: placement.left, top: clamped })
  }, [placement])

  function clearTimer(): void {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }

  /** Beside the row where there is room for it, under it where there is not. */
  function place(): void {
    const rect = anchor.current?.getBoundingClientRect()
    if (!rect) return

    const beside = rect.left - WIDTH - GAP
    if (beside >= EDGE) {
      setPlacement({ top: rect.top, left: beside })

      return
    }

    setPlacement({
      top: rect.bottom + GAP,
      left: Math.max(EDGE, Math.min(rect.left, window.innerWidth - WIDTH - EDGE)),
    })
  }

  function rest(): void {
    clearTimer()
    timer.current = setTimeout(place, delayMs)
  }

  function leave(): void {
    clearTimer()
    setPlacement(null)
  }

  if (!hint) return children

  return (
    <span
      ref={anchor}
      className="block"
      onPointerEnter={rest}
      onPointerLeave={leave}
      onFocusCapture={place}
      onBlurCapture={leave}
    >
      {children}

      {placement &&
        createPortal(
          <span
            ref={bubble}
            role="tooltip"
            style={{ top: placement.top, left: placement.left, width: WIDTH }}
            className="popover pointer-events-none fixed z-50 block p-3 text-[0.72rem] leading-5 text-text"
          >
            {hint}
          </span>,
          document.body,
        )}
    </span>
  )
}
