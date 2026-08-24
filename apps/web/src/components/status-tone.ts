import { isHumanGate, type TaskState } from '@specmate/core'

/** The small, shared vocabulary of visual tones a status badge can carry. */
export type StatusTone = 'active' | 'parked' | 'failed' | 'done' | 'muted' | 'warning'

/** Where a task's state sits in that vocabulary — the chip and the index read it the same way. */
export function statusTone(status: TaskState): StatusTone {
  if (isHumanGate(status) || status === 'waiting_human') return 'parked'
  if (status === 'failed' || status === 'blocked') return 'failed'
  if (status === 'archived' || status === 'cancelled') return 'done'
  if (status === 'draft' || status === 'paused') return 'muted'

  return 'active'
}

const TONE_CLASSES: Record<StatusTone, string> = {
  active: 'badge-active',
  parked: 'badge-parked',
  failed: 'badge-failed',
  done: 'badge-done',
  muted: 'badge-muted',
  warning: 'badge-warning',
}

export function toneClasses(tone: StatusTone): string {
  return TONE_CLASSES[tone]
}

const TONE_DOT: Record<StatusTone, string> = {
  active: 'bg-status-active',
  parked: 'bg-status-parked',
  failed: 'bg-status-failed',
  done: 'bg-status-done',
  muted: 'bg-muted',
  warning: 'bg-attention',
}

/** The same tone as a mark rather than a pill, for lists too dense to carry chips. */
export function toneDot(tone: StatusTone): string {
  return TONE_DOT[tone]
}

/**
 * The pill markup `StatusChip` and `HarnessBadge` both render, tone classes
 * appended by the caller. A word in the tone's colour on a wash of it: the
 * outline it used to wear made a two-word fact read like a control.
 */
export const STATUS_BADGE_BASE_CLASSES = 'badge'
