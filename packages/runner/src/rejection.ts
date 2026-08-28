import { collapseWhitespace, FAILURE_KINDS, type FailureReason } from '@specmate/core'
import { truncate } from './truncate.ts'

/** What the harness declined an attempt for, as the next attempt is told it (REQ-217). */
export interface StageRejection {
  readonly attempt: number
  /**
   * A member of the table, not any string the failure payload can carry: an
   * engine enum such as `orphaned` is not something an agent did, and rendering
   * one here would ask it to correct a process restart.
   */
  readonly reason: FailureReason
  readonly detail: string | null
  /** Whether the tree was taken back to the last accepted commit before this attempt. */
  readonly workspaceReset: boolean
}

/**
 * A detail is agent prose or the list of paths a run touched, and neither has a
 * bound of its own — an install that left `node_modules` untracked writes tens
 * of thousands of them. Capped here rather than at each caller so the prompt
 * and the ledger cannot disagree about how much of it survives.
 */
const DETAIL_LIMIT_BYTES = 2_000

/**
 * One shape, two channels: the ledger carries this across a re-dispatch, the
 * prompt across the executor's own retry. A retry told nothing has no reason to
 * behave differently from the attempt it repeats, which is what turns a
 * mechanical defect into four full runs.
 */
export function renderRejection(rejection: StageRejection): string[] {
  const kind = FAILURE_KINDS[rejection.reason]
  const lines = [`- Attempt ${rejection.attempt} ended: ${kind.sentence}`]

  if (rejection.detail) {
    // Collapsed after the cut, not before: truncate announces itself on its own
    // line, and this has to stay one bullet.
    const detail = collapseWhitespace(truncate(rejection.detail, DETAIL_LIMIT_BYTES, 'the detail'))
    lines.push(`- What was wrong: ${detail}`)
  }

  // The discard between attempts is invisible from inside a forked session: its
  // transcript says it wrote those files. An attempt that believes them still
  // there writes only the correction and leaves the change folder half-built.
  if (rejection.workspaceReset) {
    lines.push(
      '- The working tree was taken back to the last accepted commit, so nothing that attempt wrote is still there.',
    )
  }

  // Only a rejection of complete work names a correction. A run that timed out
  // or could not be started left nothing to correct, and saying otherwise sends
  // an agent hunting for a defect in work it never produced.
  const closing = kind.producedResult
    ? 'That is the correction to make; it is why this attempt exists.'
    : 'Nothing in that attempt is yours to correct — do the work again from the start.'

  return [...lines, '', closing]
}
