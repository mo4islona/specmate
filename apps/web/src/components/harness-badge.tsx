import type { HarnessStatus } from '@specmate/core'
import { Badge, type BadgeTone } from '../ui/index.ts'

interface HarnessBadgeProps {
  status: HarnessStatus
}

const LABELS: Record<HarnessStatus, string> = {
  unknown: 'harness: unknown',
  adequate: 'harness: adequate',
  partial: 'harness gap: partial',
  missing: 'harness gap: missing',
  waived: 'harness: waived',
}

/**
 * REQ-1405: a waiver stays visible without opening an artifact — styled apart
 * from an open, undecided gap (the 'warning' tone, matching the decision-card
 * convention for something awaiting the owner) since a waiver is already a
 * decided, accepted risk, not a pending one.
 */
function statusTone(status: HarnessStatus): BadgeTone {
  if (status === 'waived') return 'failed'
  if (status === 'partial' || status === 'missing') return 'warning'

  return 'muted'
}

/** Renders nothing for `adequate` or `unknown` — nothing here needs the owner's attention. */
export function HarnessBadge({ status }: HarnessBadgeProps) {
  if (status === 'adequate' || status === 'unknown') return null

  return (
    <Badge tone={statusTone(status)} data-harness-status={status}>
      {LABELS[status]}
    </Badge>
  )
}
