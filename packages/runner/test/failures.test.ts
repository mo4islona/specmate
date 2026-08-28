import { FAILURE_KINDS, isFailureReason, isRetryable } from '@specmate/core'
import { describe, expect, it } from 'vitest'
import { CONVERSATION_FAILURES } from '../src/conversation-executor.ts'
import { STAGE_FAILURES } from '../src/executor.ts'

/** Every member either vocabulary can carry, each named once. */
const VOCABULARY = [...new Set<string>([...STAGE_FAILURES, ...CONVERSATION_FAILURES])].sort()

function membersWhere(
  predicate: (kind: (typeof FAILURE_KINDS)[keyof typeof FAILURE_KINDS]) => boolean,
) {
  return Object.entries(FAILURE_KINDS)
    .filter(([, kind]) => predicate(kind))
    .map(([reason]) => reason)
    .sort()
}

describe('the failure vocabulary', () => {
  it('is one table, and both vocabularies are subsets of it', () => {
    expect(Object.keys(FAILURE_KINDS).sort()).toEqual(VOCABULARY)
  })

  it('tells every member apart in the sentence a reader gets', () => {
    const sentences = Object.values(FAILURE_KINDS).map((kind) => kind.sentence)

    expect(new Set(sentences).size).toBe(sentences.length)
    expect(sentences.every((sentence) => sentence.endsWith('.'))).toBe(true)
  })

  it('holds back a retry only where re-running is the same run again', () => {
    expect(membersWhere((kind) => !kind.retryable)).toEqual(['backend_error'])
  })

  /**
   * The runtime not answering is not the runtime saying no. Only the second is
   * settled enough to spend a task's last chance on, and collapsing them is how
   * a daemon restart during a deploy ends a task that was otherwise healthy.
   */
  it('keeps a runtime that could not be asked on the retryable side', () => {
    expect(isRetryable('backend_unavailable')).toBe(true)
    expect(isRetryable('backend_error')).toBe(false)
  })

  it('counts as declined only the checks a complete run can fail', () => {
    expect(membersWhere((kind) => kind.producedResult)).toEqual([
      'incomplete_brief',
      'scope_violation',
      'uncheckable_verdict',
      'uncorroborated',
    ])
  })

  /**
   * A corroboration decline is a complete, parsed result the harness would not
   * accept — the case the retry-keeps-its-session path exists for. Sharing
   * `invalid_result` with an unreadable envelope forced it onto the cold path.
   */
  it('separates a verdict it could not check from a result it could not read', () => {
    expect(FAILURE_KINDS.uncheckable_verdict.producedResult).toBe(true)
    expect(FAILURE_KINDS.invalid_result.producedResult).toBe(false)
  })

  it('recognises only its own members, not what every object inherits', () => {
    expect(isFailureReason('timeout')).toBe(true)
    expect(isFailureReason('constructor')).toBe(false)
    expect(isFailureReason('toString')).toBe(false)
  })
})
