import { isHumanGate, type TaskState } from '@specmate/core'

interface StatusChipProps {
  status: TaskState
}

function statusClasses(status: TaskState): string {
  if (isHumanGate(status) || status === 'waiting_human') {
    return 'border-status-parked/45 bg-status-parked/10 text-status-parked'
  }
  if (status === 'failed' || status === 'blocked') {
    return 'border-status-failed/45 bg-status-failed/10 text-status-failed'
  }
  if (status === 'archived' || status === 'cancelled') {
    return 'border-status-done/40 bg-status-done/10 text-status-done'
  }
  if (status === 'draft' || status === 'paused') {
    return 'border-muted/35 bg-muted/5 text-muted'
  }

  return 'border-status-active/40 bg-status-active/10 text-status-active'
}

export function StatusChip({ status }: StatusChipProps) {
  return (
    <span
      className={`inline-flex max-w-full items-center border px-2 py-1 font-mono text-[0.65rem] uppercase tracking-[0.12em] ${statusClasses(status)}`}
    >
      {status.replaceAll('_', ' ')}
    </span>
  )
}
