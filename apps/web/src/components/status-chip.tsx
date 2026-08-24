import type { TaskState } from '@specmate/core'
import { Badge } from '../ui/index.ts'
import { statusTone } from './status-tone.ts'

interface StatusChipProps {
  status: TaskState
}

export function StatusChip({ status }: StatusChipProps) {
  return <Badge tone={statusTone(status)}>{status.replaceAll('_', ' ')}</Badge>
}
