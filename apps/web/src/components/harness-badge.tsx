import type { HarnessStatus } from '@specmate/core'
import { Badge } from '../ui/index.ts'

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
 * REQ-1405: a waiver stays visible without opening an artifact, and it reads
 * apart from an open, undecided gap — in the word rather than in a colour. The
 * badge qualifies the state sentence beside it; it is not a second one. Amber
 * here put two things asking for the owner in one header row, and a waiver in
 * red claimed something had gone wrong when a decision had in fact been made.
 */
export function HarnessBadge({ status }: HarnessBadgeProps) {
  if (status === 'adequate' || status === 'unknown') return null

  return <Badge data-harness-status={status}>{LABELS[status]}</Badge>
}
