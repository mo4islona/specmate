import { isHumanGate, type TaskState } from '@specmate/core'
import { STATUS_BADGE_BASE_CLASSES, toneClasses } from './status-tone.ts'

interface StatusChipProps {
  status: TaskState
}

function statusClasses(status: TaskState): string {
  if (isHumanGate(status) || status === 'waiting_human') return toneClasses('parked')
  if (status === 'failed' || status === 'blocked') return toneClasses('failed')
  if (status === 'archived' || status === 'cancelled') return toneClasses('done')
  if (status === 'draft' || status === 'paused') return toneClasses('muted')

  return toneClasses('active')
}

export function StatusChip({ status }: StatusChipProps) {
  return (
    <span className={`${STATUS_BADGE_BASE_CLASSES} ${statusClasses(status)}`}>
      {status.replaceAll('_', ' ')}
    </span>
  )
}
