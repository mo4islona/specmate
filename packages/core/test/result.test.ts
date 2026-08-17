import { describe, expect, test } from 'bun:test'
import { ConversationResult, checkReviseHasFindings, parseStageResult } from '../src/result.ts'
import { ARTIFACT_KINDS, pickReviewProvider, ROLE_CONTRACTS } from '../src/roles.ts'

const minimal = {
  schema_version: 1,
  role: 'researcher',
  status: 'ok',
}

describe('RESULT.json contract', () => {
  test('accepts a minimal result and fills defaults', () => {
    const parsed = parseStageResult(JSON.stringify(minimal))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.artifacts_changed).toEqual([])
    expect(parsed.value.decisions_needed).toEqual([])
    expect(parsed.value.notes_md).toBe('')
  })

  test('rejects malformed JSON with a readable error', () => {
    const parsed = parseStageResult('{not json')
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error).toContain('invalid JSON')
  })

  test('rejects an unknown role', () => {
    const parsed = parseStageResult(JSON.stringify({ ...minimal, role: 'architect' }))
    expect(parsed.ok).toBe(false)
  })

  test('accepts the answer-only role', () => {
    const parsed = parseStageResult(JSON.stringify({ ...minimal, role: 'answerer' }))
    expect(parsed.ok).toBe(true)
  })

  test('carries reviewer verdict and findings', () => {
    const parsed = parseStageResult(
      JSON.stringify({
        ...minimal,
        role: 'reviewer',
        verdict: 'revise',
        findings: [{ id: 'F1', severity: 'blocking', title: 'no traceability' }],
      }),
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.verdict).toBe('revise')
    expect(parsed.value.findings[0]?.id).toBe('F1')
  })

  test('rejects a verdict-less result from a role that must return one, naming the role', () => {
    const parsed = parseStageResult(JSON.stringify({ ...minimal, role: 'verifier' }))
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error).toContain('verifier')
  })

  test('accepts a verdict-less result from a role that need not return one', () => {
    const parsed = parseStageResult(JSON.stringify(minimal))
    expect(parsed.ok).toBe(true)
  })
})

describe('checkReviseHasFindings', () => {
  const revise = {
    schema_version: 1 as const,
    role: 'reviewer' as const,
    status: 'ok' as const,
    verdict: 'revise' as const,
    artifacts_changed: [],
    decisions_needed: [],
    findings: [],
    notes_md: '',
    usage: {},
  }

  test('rejects a revise with no findings', () => {
    expect(checkReviseHasFindings(revise)).toContain('reviewer')
  })

  test('accepts a revise backed by an explicit finding set (e.g. derived scenario findings)', () => {
    const derived = [
      { id: 'AC-1', severity: 'blocking' as const, title: 'uncovered', detail_md: '' },
    ]
    expect(checkReviseHasFindings(revise, derived)).toBeNull()
  })

  test('ignores approve and escalate verdicts', () => {
    expect(checkReviseHasFindings({ ...revise, verdict: 'approve' })).toBeNull()
    expect(checkReviseHasFindings({ ...revise, verdict: 'escalate' })).toBeNull()
  })
})

describe('role contracts', () => {
  test('answerer reads every artifact kind and may write nothing', () => {
    expect(ROLE_CONTRACTS.answerer).toMatchObject({ writes: [], writesCode: false })
    expect(ROLE_CONTRACTS.answerer.reads).toEqual(ARTIFACT_KINDS)
  })

  test('only implementer and verifier may touch product code', () => {
    const codeWriters = Object.values(ROLE_CONTRACTS)
      .filter((c) => c.writesCode)
      .map((c) => c.role)
    expect(codeWriters.sort()).toEqual(['implementer', 'verifier'])
  })

  test('only reviewer and verifier must return a verdict', () => {
    const verdictRoles = Object.values(ROLE_CONTRACTS)
      .filter((c) => c.returnsVerdict)
      .map((c) => c.role)
    expect(verdictRoles.sort()).toEqual(['reviewer', 'verifier'])
  })

  test('only verifier is corroborated against committed evidence', () => {
    const corroborated = Object.values(ROLE_CONTRACTS)
      .filter((c) => c.corroborated)
      .map((c) => c.role)
    expect(corroborated).toEqual(['verifier'])
  })

  test('spec-touching roles receive the house standard skill', () => {
    for (const role of ['researcher', 'spec_writer', 'reviewer', 'summarizer'] as const) {
      expect(ROLE_CONTRACTS[role].injectSpecSkill).toBe(true)
    }
  })

  test('no role declares decision_log among its writes — the log is generated, never authored', () => {
    const writers = Object.values(ROLE_CONTRACTS).filter((c) => c.writes.includes('decision_log'))
    expect(writers).toEqual([])
  })

  test('review provider differs from the writer', () => {
    expect(pickReviewProvider('claude-code')).not.toBe('claude-code')
    expect(pickReviewProvider('codex')).not.toBe('codex')
  })

  test('a single available provider degrades to same-provider review', () => {
    expect(pickReviewProvider('codex', ['codex'])).toBe('codex')
  })
})

describe('conversation result contract', () => {
  test('rejects unknown action kinds and task states', () => {
    const base = {
      message_md: 'Done.',
      actions: [
        {
          kind: 'delete_task',
          target: { taskId: 'task-1' },
          expectedVersion: { taskStatus: 'research' },
        },
      ],
    }
    expect(ConversationResult.safeParse(base).success).toBe(false)
    expect(
      ConversationResult.safeParse({
        ...base,
        actions: [
          {
            kind: 'instruct_next_run',
            target: { taskId: 'task-1', nodeKey: 'implement' },
            expectedVersion: { taskStatus: 'teleporting' },
          },
        ],
      }).success,
    ).toBe(false)
  })
})
