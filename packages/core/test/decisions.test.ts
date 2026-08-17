import { describe, expect, test } from 'bun:test'
import {
  blockingOpen,
  decisionFromRequest,
  type EscalationInput,
  escalationForPark,
  renderDecisionLog,
  type StoredDecision,
} from '../src/decisions.ts'
import type { DecisionRequest } from '../src/result.ts'

function stored(overrides: Partial<StoredDecision> = {}): StoredDecision {
  return {
    id: 'dec-1',
    nodeKey: 'research',
    key: 'scope',
    kind: 'question',
    promptMd: 'What does this cover?',
    options: [],
    blocking: true,
    status: 'open',
    answerMd: null,
    answeredBy: null,
    answeredAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

describe('decisionFromRequest', () => {
  test('carries the node with a blocking request', () => {
    const request: DecisionRequest = {
      key: 'ambiguous-scope',
      kind: 'question',
      prompt_md: 'Which repository owns this?',
      options: [{ id: 'a', label: 'this one' }],
      blocking: true,
    }

    expect(decisionFromRequest('research', request)).toEqual({
      nodeKey: 'research',
      key: 'ambiguous-scope',
      kind: 'question',
      promptMd: 'Which repository owns this?',
      options: [{ id: 'a', label: 'this one' }],
      blocking: true,
    })
  })

  test('carries the node with a non-blocking request', () => {
    const request: DecisionRequest = {
      key: 'style-nit',
      kind: 'question',
      prompt_md: 'Worth a follow-up task?',
      options: [],
      blocking: false,
    }

    expect(decisionFromRequest('kickoff_brief', request).blocking).toBe(false)
    expect(decisionFromRequest('kickoff_brief', request).nodeKey).toBe('kickoff_brief')
  })
})

describe('escalationForPark', () => {
  const cases: { name: string; input: EscalationInput }[] = [
    {
      name: 'escalate',
      input: {
        cause: 'escalate',
        nodeKey: 'spec_review',
        loop: 'spec',
        round: 2,
        verdict: 'escalate',
        findings: [{ id: 'f1', severity: 'blocking', title: 'Missing acceptance criteria' }],
      },
    },
    {
      name: 'cap_exhausted',
      input: { cause: 'cap_exhausted', nodeKey: 'code_review', loop: 'impl', round: 3, cap: 3 },
    },
    {
      name: 'repeated_finding',
      input: {
        cause: 'repeated_finding',
        nodeKey: 'spec_review',
        loop: 'spec',
        round: 2,
        finding: { id: 'f1', rounds: [2, 1] },
      },
    },
  ]

  for (const { name, input } of cases) {
    test(`renders a decision naming the cause for ${name}`, () => {
      const decision = escalationForPark(input)
      expect(decision.kind).toBe('escalation')
      expect(decision.blocking).toBe(true)
      expect(decision.nodeKey).toBe(input.nodeKey)
      expect(decision.promptMd.length).toBeGreaterThan(0)
    })
  }

  test('the key derives from cause and round, so one park raises one decision', () => {
    const first = escalationForPark({
      cause: 'cap_exhausted',
      nodeKey: 'implement',
      loop: 'impl',
      round: 3,
      cap: 3,
    })
    const again = escalationForPark({
      cause: 'cap_exhausted',
      nodeKey: 'implement',
      loop: 'impl',
      round: 3,
      cap: 3,
    })
    expect(first.key).toBe(again.key)

    const nextRound = escalationForPark({
      cause: 'cap_exhausted',
      nodeKey: 'implement',
      loop: 'impl',
      round: 4,
      cap: 3,
    })
    expect(nextRound.key).not.toBe(first.key)
  })

  test('escalate carries the round verdict and findings', () => {
    const decision = escalationForPark({
      cause: 'escalate',
      nodeKey: 'code_review',
      loop: 'impl',
      round: 1,
      verdict: 'escalate',
      findings: [{ id: 'f9', severity: 'major', title: 'Race condition', detail_md: 'see lock' }],
    })
    expect(decision.promptMd).toContain('escalate')
    expect(decision.promptMd).toContain('f9')
    expect(decision.promptMd).toContain('Race condition')
  })

  test('cap_exhausted carries the loop identity and the cap', () => {
    const decision = escalationForPark({
      cause: 'cap_exhausted',
      nodeKey: 'implement',
      loop: 'impl',
      round: 3,
      cap: 3,
    })
    expect(decision.promptMd).toContain('impl')
    expect(decision.promptMd).toContain('3')
  })

  test('repeated_finding carries the identifier and its rounds', () => {
    const decision = escalationForPark({
      cause: 'repeated_finding',
      nodeKey: 'spec_review',
      loop: 'spec',
      round: 3,
      finding: { id: 'stubborn-finding', rounds: [3, 2] },
    })
    expect(decision.promptMd).toContain('stubborn-finding')
    expect(decision.promptMd).toContain('3, 2')
  })
})

describe('blockingOpen', () => {
  test('a non-blocking-only open set does not block', () => {
    expect(blockingOpen([stored({ blocking: false, status: 'open' })])).toBe(false)
  })

  test('an empty set does not block', () => {
    expect(blockingOpen([])).toBe(false)
  })

  test('a blocking open decision blocks', () => {
    expect(blockingOpen([stored({ blocking: true, status: 'open' })])).toBe(true)
  })

  test('a resolved blocking decision does not block', () => {
    expect(blockingOpen([stored({ blocking: true, status: 'answered' })])).toBe(false)
  })
})

describe('renderDecisionLog', () => {
  test('renders deterministically and identically across two renders', () => {
    const set = [
      stored({ id: 'a', key: 'scope', createdAt: new Date('2026-01-01T00:00:00Z') }),
      stored({
        id: 'b',
        key: 'answered',
        status: 'answered',
        answerMd: 'Yes, both.',
        answeredBy: 'owner',
        answeredAt: new Date('2026-01-02T00:00:00Z'),
        createdAt: new Date('2026-01-01T01:00:00Z'),
      }),
    ]
    expect(renderDecisionLog(set)).toBe(renderDecisionLog(set))
    expect(renderDecisionLog([...set].reverse())).toBe(renderDecisionLog(set))
  })

  test('states that the file is generated', () => {
    expect(renderDecisionLog([])).toMatch(/generated/i)
  })

  test('a dismissal does not render as an empty answer', () => {
    const rendered = renderDecisionLog([
      stored({
        status: 'dismissed',
        answerMd: 'Superseded by a later decision.',
        answeredBy: 'owner',
        answeredAt: new Date('2026-01-02T00:00:00Z'),
      }),
    ])
    expect(rendered).toContain('dismissed')
    expect(rendered).not.toMatch(/Answer:\s*$/m)
  })
})
