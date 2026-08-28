import { describe, expect, it } from 'bun:test'
import { FAILURE_KINDS } from '@specmate/core'
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

  it('counts as declined only the checks a complete run can fail', () => {
    expect(membersWhere((kind) => kind.producedResult)).toEqual([
      'incomplete_brief',
      'scope_violation',
      'uncorroborated',
    ])
  })
})
