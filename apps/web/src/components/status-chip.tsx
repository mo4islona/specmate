import type { TaskState } from '@specmate/core'
import { STATUS_BADGE_BASE_CLASSES, statusTone, toneClasses } from './status-tone.ts'

interface StatusChipProps {
  status: TaskState
}

export function StatusChip({ status }: StatusChipProps) {
  return (
    <span className={`${STATUS_BADGE_BASE_CLASSES} ${toneClasses(statusTone(status))}`}>
      {status.replaceAll('_', ' ')}
    </span>
  )
}
