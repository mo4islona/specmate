import { useEffect, useState } from 'react'

/**
 * A ticking clock for elapsed-time readouts.
 *
 * `ticking` is whether anything is actually counting up. A finished step's
 * duration is the distance between two timestamps it already carries, so a
 * clock over one is a redraw a second of a screen that cannot have changed —
 * and a rail of ten of them was doing it whether or not the task was running.
 */
export function useNow(ticking = true, intervalMs = 1_000): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!ticking) return

    const timer = setInterval(() => setNow(Date.now()), intervalMs)

    return () => clearInterval(timer)
  }, [ticking, intervalMs])

  return now
}
