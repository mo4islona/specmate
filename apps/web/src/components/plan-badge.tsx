import type { PlanSize } from '@specmate/core'
import { STATUS_BADGE_BASE_CLASSES, toneClasses } from './status-tone.ts'

interface PlanBadgeProps {
  size: PlanSize | null
}

/**
 * The size planning declared, which is also the shape of the run: `small`
 * drops the second planner pass and the spec review, so the owner should be
 * able to see it without opening the brief (REQ-408).
 */
export function PlanBadge({ size }: PlanBadgeProps) {
  if (!size) return null

  return (
    <span
      className={`${STATUS_BADGE_BASE_CLASSES} ${toneClasses(size === 'small' ? 'muted' : 'done')}`}
      data-plan-size={size}
    >
      size: {size}
    </span>
  )
}
