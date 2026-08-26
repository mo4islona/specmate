import { useEffect, useState } from 'react'

/** How far outside the viewport still counts as near — half a screen of warning. */
const MARGIN = '600px 0px'

/**
 * Whether an element has come within half a screen of the viewport, ever.
 *
 * It latches on purpose: what has been drawn stays drawn. Tearing a diff back
 * down when it scrolls away costs a second relayout, and the reader's place in
 * a long column moves when the box under their thumb changes height.
 *
 * The element arrives through a callback ref rather than a `useRef`, so an
 * element the caller swaps for another — a diff read in one column and then in
 * two — is observed rather than left watching a node nobody can see any more.
 *
 * Where there is no `IntersectionObserver` — jsdom has none — everything is
 * near, which is what every caller did before this existed.
 */
export function useNearViewport<T extends Element>(): [(node: T | null) => void, boolean] {
  const [node, setNode] = useState<T | null>(null)
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined')

  useEffect(() => {
    if (near || node === null) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true)
      },
      { rootMargin: MARGIN },
    )
    observer.observe(node)

    return () => observer.disconnect()
  }, [near, node])

  return [setNode, near]
}
