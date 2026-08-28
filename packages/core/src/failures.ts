/**
 * What the harness knows about one way an attempt can end badly.
 *
 * The two properties are the ones every branch below needs: whether there is
 * sound work to hand back, and whether running the same thing again can come
 * out differently. They live here rather than being re-derived at each branch
 * because a member added without deciding them would otherwise join the
 * expensive path by saying nothing.
 */
export interface FailureKind {
  /**
   * The run completed and handed over a result, which the harness then declined
   * for a named, checkable defect. False when the run itself is what went wrong.
   */
  readonly producedResult: boolean
  /** Whether re-running the same attempt can change the outcome. */
  readonly retryable: boolean
  /** What a reader is told the failure was, in place of its identifier. */
  readonly sentence: string
}

/**
 * The whole failure vocabulary. Each caller's own list — a provider run, a
 * stage, a conversation turn — is a subset of this one, so the members cannot
 * drift apart the way three independent unions did.
 */
export const FAILURE_KINDS = {
  timeout: {
    producedResult: false,
    retryable: true,
    sentence: 'The run did not finish inside its time limit.',
  },
  // The one failure re-running cannot change: the image the host must run is
  // absent, and it is absent the second time too. A runtime that merely could
  // not be asked is `backend_unavailable` — a "no" and an unanswered question
  // are different facts, and only the first one is settled.
  backend_error: {
    producedResult: false,
    retryable: false,
    sentence: 'The run could not be started: its image is missing on the host that must run it.',
  },
  backend_unavailable: {
    producedResult: false,
    retryable: true,
    sentence: 'The run could not be started: the container runtime did not answer.',
  },
  provider_error: {
    producedResult: false,
    retryable: true,
    sentence: 'The provider did not produce a result.',
  },
  no_result: {
    producedResult: false,
    retryable: true,
    sentence: 'The run finished and left no result.',
  },
  invalid_result: {
    producedResult: false,
    retryable: true,
    sentence: 'The run left a result that could not be read.',
  },
  agent_failed: {
    producedResult: false,
    retryable: true,
    sentence: 'The agent reported that it could not do the work.',
  },
  scope_violation: {
    producedResult: true,
    retryable: true,
    sentence: 'The run changed files its role may not touch.',
  },
  incomplete_brief: {
    producedResult: true,
    retryable: true,
    sentence: 'The brief is missing what the pipeline needs to start.',
  },
  uncorroborated: {
    producedResult: true,
    retryable: true,
    sentence: 'The run approved what its own report does not support.',
  },
  // Sibling of `uncorroborated`, and `producedResult` for the same reason: the
  // result parsed and cleared every check before this one, so the reasoning
  // that produced it is worth handing back. Distinct from `invalid_result`,
  // which is an envelope nobody could read.
  uncheckable_verdict: {
    producedResult: true,
    retryable: true,
    sentence: 'The run left a verdict the harness could not check against its report.',
  },
  malformed_message: {
    producedResult: false,
    retryable: true,
    sentence: 'The reply could not be read.',
  },
  cleanup_failed: {
    producedResult: false,
    retryable: true,
    sentence: 'The stopped run could not be cleaned up.',
  },
} as const satisfies Record<string, FailureKind>

export type FailureReason = keyof typeof FAILURE_KINDS

export function isFailureReason(value: string): value is FailureReason {
  // `hasOwn`, not `in`: `constructor` and `toString` are reasons no run ever had.
  return Object.hasOwn(FAILURE_KINDS, value)
}

/**
 * Null rather than a fallback: a `reason` payload also carries engine enums
 * that were never in this vocabulary, and inventing a sentence for one would
 * make the table look like it covers them.
 */
export function failureSentence(reason: string): string | null {
  return isFailureReason(reason) ? FAILURE_KINDS[reason].sentence : null
}

/**
 * Whether another attempt at this is worth its cost. A reason the table does not
 * carry keeps its retries: only a member that says re-running cannot change the
 * outcome may spend a task's last chance (REQ-613).
 */
export function isRetryable(reason: string): boolean {
  return isFailureReason(reason) ? FAILURE_KINDS[reason].retryable : true
}
