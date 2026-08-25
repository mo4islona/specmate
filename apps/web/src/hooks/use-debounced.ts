import { useEffect, useState } from 'react'

/**
 * The value as it was `delayMs` after it last changed. Typing produces one
 * request per pause rather than one per keystroke, and the value it settles on
 * is what the query key is built from — so a burst collapses into one fetch
 * instead of a queue of them that all resolve into the same answer.
 */
export function useDebounced<T>(value: T, delayMs = 350): T {
  const [settled, setSettled] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs)

    return () => clearTimeout(timer)
  }, [value, delayMs])

  return settled
}
