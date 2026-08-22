import { useEffect, useState } from 'react'

/** A ticking clock for elapsed-time readouts; only mounted where something is actually running. */
export function useNow(intervalMs = 1_000): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)

    return () => clearInterval(timer)
  }, [intervalMs])

  return now
}
