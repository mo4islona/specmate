import { describe, expect, test } from 'vitest'
import {
  ConversationResult,
  checkDecisionsPresent,
  checkHarnessCoveragePresent,
  checkPlanPresent,
  checkReviseHasFindings,
  parseStageResult,
} from '../src/result.ts'
import { AGENT_ROLES, ARTIFACT_KINDS, pickReviewProvider, ROLE_CONTRACTS } from '../src/roles.ts'

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

  test('rejects needs_decision with no decisions_needed, naming the role', () => {
    const parsed = parseStageResult(JSON.stringify({ ...minimal, status: 'needs_decision' }))
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error).toContain('researcher')
    expect(parsed.error).toContain('needs_decision')
  })

  test('accepts needs_decision backed by at least one decision request', () => {
    const parsed = parseStageResult(
      JSON.stringify({
        ...minimal,
        status: 'needs_decision',
        decisions_needed: [{ key: 'scope', prompt_md: 'Which repo owns this?' }],
      }),
    )
    expect(parsed.ok).toBe(true)
  })

  test('rejects a coverage-less ok result from the planner, naming the role', () => {
    const parsed = parseStageResult(JSON.stringify({ ...minimal, role: 'planner' }))
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error).toContain('planner')
    expect(parsed.error).toContain('harness coverage')
  })

  test('rejects a plan declaring a size but no title, naming the missing part (AC-1321)', () => {
    const parsed = parseStageResult(
      JSON.stringify({
        ...minimal,
        role: 'planner',
        harness_coverage: { classification: 'adequate', evidence_md: 'An e2e suite covers it.' },
        plan: { type: 'bugfix', size: 'small' },
      }),
    )
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error).toContain('plan.title')
  })

  test('accepts a planner result carrying its coverage assessment and plan', () => {
    const parsed = parseStageResult(
      JSON.stringify({
        ...minimal,
        role: 'planner',
        harness_coverage: { classification: 'missing', evidence_md: 'No tests touch this path.' },
        plan: { title: 'Backfill the ingestion cursor', type: 'bugfix', size: 'small' },
      }),
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.harness_coverage?.classification).toBe('missing')
    expect(parsed.value.plan?.size).toBe('small')
    expect(parsed.value.plan?.prerequisites).toEqual([])
  })

  test('rejects a plan-less ok result from the planner, naming the role', () => {
    const parsed = parseStageResult(
      JSON.stringify({
        ...minimal,
        role: 'planner',
        harness_coverage: { classification: 'adequate', evidence_md: 'An e2e suite covers it.' },
      }),
    )
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error).toContain('planner')
    expect(parsed.error).toContain('plan')
  })

  test('rejects two prerequisites sharing one key', () => {
    const prerequisite = {
      key: 'ingestion-harness',
      title: 'Harness',
      why_md: 'Nothing covers it.',
    }
    const parsed = parseStageResult(
      JSON.stringify({
        ...minimal,
        role: 'planner',
        harness_coverage: { classification: 'missing', evidence_md: 'No tests touch this path.' },
        plan: {
          title: 'Split the ingestion pipeline',
          type: 'feature',
          size: 'large',
          prerequisites: [prerequisite, prerequisite],
        },
      }),
    )
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error).toContain('ingestion-harness')
  })

  test('accepts a coverage-less planner result for the request-does-not-fit case', () => {
    const parsed = parseStageResult(
      JSON.stringify({
        ...minimal,
        role: 'planner',
        status: 'needs_decision',
        decisions_needed: [
          { key: 'unplaceable', prompt_md: 'Where does this belong?', blocking: true },
        ],
      }),
    )
    expect(parsed.ok).toBe(true)
  })

  test('accepts a coverage-less result from a role that does not probe', () => {
    const parsed = parseStageResult(JSON.stringify(minimal))
    expect(parsed.ok).toBe(true)
  })
})

describe('checkHarnessCoveragePresent', () => {
  const plannerOk = {
    schema_version: 1 as const,
    role: 'planner' as const,
    status: 'ok' as const,
    artifacts_changed: [],
    decisions_needed: [],
    findings: [],
    notes_md: '',
    usage: {},
  }

  test('rejects a probing role missing its assessment', () => {
    expect(checkHarnessCoveragePresent(plannerOk)).toContain('planner')
  })

  test('accepts a probing role carrying its assessment', () => {
    const withCoverage = {
      ...plannerOk,
      harness_coverage: {
        classification: 'adequate' as const,
        evidence_md: 'e2e suite covers it.',
      },
    }
    expect(checkHarnessCoveragePresent(withCoverage)).toBeNull()
  })

  test('ignores a non-probing role regardless of coverage', () => {
    expect(checkHarnessCoveragePresent({ ...plannerOk, role: 'researcher' })).toBeNull()
  })

  test('ignores a probing role that has not reached ok status', () => {
    expect(checkHarnessCoveragePresent({ ...plannerOk, status: 'needs_decision' })).toBeNull()
    expect(checkHarnessCoveragePresent({ ...plannerOk, status: 'failed' })).toBeNull()
  })

  test('ignores a continuation, which re-probes nothing', () => {
    expect(checkHarnessCoveragePresent(plannerOk, true)).toBeNull()
  })
})

describe('checkPlanPresent', () => {
  const plannerOk = {
    schema_version: 1 as const,
    role: 'planner' as const,
    status: 'ok' as const,
    artifacts_changed: [],
    decisions_needed: [],
    findings: [],
    notes_md: '',
    usage: {},
  }

  test('exactly the planner declares a plan', () => {
    const declaring = AGENT_ROLES.filter((role) => ROLE_CONTRACTS[role].declaresPlan)
    expect(declaring).toEqual(['planner'])
  })

  test('rejects a planning role missing its plan', () => {
    expect(checkPlanPresent(plannerOk)).toContain('planner')
  })

  test('accepts a planning role carrying one', () => {
    expect(
      checkPlanPresent({
        ...plannerOk,
        plan: {
          title: 'Rework the retry policy',
          type: 'feature',
          size: 'medium',
          prerequisites: [],
        },
      }),
    ).toBeNull()
  })

  test('ignores a role that declares no plan', () => {
    expect(checkPlanPresent({ ...plannerOk, role: 'researcher' })).toBeNull()
  })

  test('ignores a continuation, which declares no size of its own', () => {
    expect(checkPlanPresent(plannerOk, true)).toBeNull()
  })

  test('ignores a planning role that has not reached ok status', () => {
    expect(checkPlanPresent({ ...plannerOk, status: 'needs_decision' })).toBeNull()
    expect(checkPlanPresent({ ...plannerOk, status: 'failed' })).toBeNull()
  })
})

describe('checkDecisionsPresent', () => {
  const needsDecision = {
    schema_version: 1 as const,
    role: 'researcher' as const,
    status: 'needs_decision' as const,
    artifacts_changed: [],
    decisions_needed: [],
    findings: [],
    notes_md: '',
    usage: {},
  }

  test('rejects needs_decision with an empty decisions_needed', () => {
    expect(checkDecisionsPresent(needsDecision)).toContain('researcher')
  })

  test('accepts needs_decision with at least one decision request', () => {
    const withRequest = {
      ...needsDecision,
      decisions_needed: [
        {
          key: 'scope',
          kind: 'question' as const,
          prompt_md: 'Which repo?',
          options: [],
          blocking: true,
        },
      ],
    }
    expect(checkDecisionsPresent(withRequest)).toBeNull()
  })

  test('ignores ok and failed statuses regardless of decisions_needed', () => {
    expect(checkDecisionsPresent({ ...needsDecision, status: 'ok' })).toBeNull()
    expect(checkDecisionsPresent({ ...needsDecision, status: 'failed' })).toBeNull()
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

  test('AC-102: only implementing roles may touch product code', () => {
    const codeWriters = Object.values(ROLE_CONTRACTS)
      .filter((c) => c.writesCode)
      .map((c) => c.role)
    expect(codeWriters.sort()).toEqual(['implementer', 'validator', 'verifier'])
  })

  test('only the checking roles must return a verdict', () => {
    const verdictRoles = Object.values(ROLE_CONTRACTS)
      .filter((c) => c.returnsVerdict)
      .map((c) => c.role)
    expect(verdictRoles.sort()).toEqual(['reviewer', 'validator', 'verifier'])
  })

  test('only the planner probes harness coverage', () => {
    const probingRoles = Object.values(ROLE_CONTRACTS)
      .filter((c) => c.probesHarness)
      .map((c) => c.role)
    expect(probingRoles).toEqual(['planner'])
  })

  test('planner writes the brief and, at its second node, the specification', () => {
    expect(ROLE_CONTRACTS.planner.reads).toEqual(['proposal', 'design', 'spec', 'decision_log'])
    expect(ROLE_CONTRACTS.planner.writes).toEqual(['proposal', 'design', 'spec'])
    expect(ROLE_CONTRACTS.planner.writesCode).toBe(false)
    expect(ROLE_CONTRACTS.planner.injectSpecSkill).toBe(true)
  })

  test('only planner has its proposal output checked for completeness', () => {
    const checked = Object.values(ROLE_CONTRACTS)
      .filter((c) => c.checksProposalCompleteness)
      .map((c) => c.role)
    expect(checked).toEqual(['planner'])
  })

  test('only a role reporting on execution is corroborated against committed evidence', () => {
    const corroborated = Object.values(ROLE_CONTRACTS)
      .filter((c) => c.corroborated)
      .map((c) => c.role)
    expect(corroborated.sort()).toEqual(['validator', 'verifier'])
  })

  test('spec-touching roles receive the house standard skill', () => {
    for (const role of [
      'planner',
      'researcher',
      'spec_writer',
      'reviewer',
      'summarizer',
    ] as const) {
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
