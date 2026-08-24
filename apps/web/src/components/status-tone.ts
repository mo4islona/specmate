import { isHumanGate, type TaskState } from '@specmate/core'
import type { BadgeTone } from '../ui/index.ts'

/** Where a task's state sits in the kit's tone vocabulary — the chip and the index read it the same way. */
export function statusTone(status: TaskState): BadgeTone {
  if (isHumanGate(status) || status === 'waiting_human') return 'parked'
  if (status === 'failed' || status === 'blocked') return 'failed'
  if (status === 'archived' || status === 'cancelled') return 'done'
  if (status === 'draft' || status === 'paused') return 'muted'

  return 'active'
}

const TONE_DOT: Record<BadgeTone, string> = {
  active: 'bg-status-active',
  parked: 'bg-status-parked',
  failed: 'bg-status-failed',
  done: 'bg-status-done',
  muted: 'bg-muted',
  warning: 'bg-attention',
}

/** The same tone as a mark rather than a pill, for lists too dense to carry chips. */
export function toneDot(tone: BadgeTone): string {
  return TONE_DOT[tone]
}
