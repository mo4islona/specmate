import { collapseWhitespace, failureSentence } from '@specmate/core'

/** What the harness declined an attempt for, as the next attempt is told it (REQ-217). */
export interface StageRejection {
  readonly attempt: number
  readonly reason: string
  readonly detail: string | null
}

/**
 * One shape, two channels: the ledger carries this across a re-dispatch, the
 * prompt across the executor's own retry. A retry told nothing has no reason to
 * behave differently from the attempt it repeats, which is what turns a
 * mechanical defect into four full runs.
 */
export function renderRejection(rejection: StageRejection): string[] {
  const lines = [
    `- Attempt ${rejection.attempt} was rejected: ${failureSentence(rejection.reason) ?? rejection.reason}`,
  ]
  if (rejection.detail) {
    lines.push(`- What was wrong: ${collapseWhitespace(rejection.detail)}`)
  }

  return [...lines, '', 'That is the correction to make; it is why this attempt exists.']
}
