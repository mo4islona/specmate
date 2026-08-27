import type { ReactNode } from 'react'
import { cn } from './cn.ts'

interface RevealProps {
  /**
   * A newer answer is on its way. What is shown stays where it is, marked as
   * being refreshed — replacing a correct answer with a spinner on every
   * keystroke is how a live panel becomes something to ignore.
   */
  readonly refreshing?: boolean
  readonly className?: string
  readonly children: ReactNode
}

/**
 * Content that settles into place rather than appearing. The motion is small
 * and one-way, and the reduced-motion rule in `index.css` removes it outright.
 */
export function Reveal({ refreshing = false, className, children }: RevealProps) {
  return (
    <div
      className={cn(
        'animate-reveal',
        refreshing && 'opacity-50 transition-opacity duration-[140ms] ease-out',
        className,
      )}
      aria-busy={refreshing || undefined}
    >
      {children}
    </div>
  )
}
