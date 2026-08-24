import { describe, expect, test } from 'vitest'
import type { Spend } from '../src/budgets.ts'
import {
  type BudgetExhaustionInput,
  blockingOpen,
  budgetExhaustionDecision,
  budgetFromRaiseOption,
  budgetRaiseOptionId,
  decisionFromRequest,
  type EscalationInput,
  escalationForPark,
  partitionRequests,
  renderDecisionLog,
  type StoredDecision,
} from '../src/decisions.ts'
import type { DecisionRequest } from '../src/result.ts'
import { DEFAULT_BUDGETS } from '../src/state.ts'

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
        findings: [
          {
            id: 'f1',
            severity: 'blocking',
            title: 'Missing acceptance criteria',
            detail_md: 'The scenario says what happens, never what makes it pass.',
          },
        ],
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

describe('budgetExhaustionDecision', () => {
  const spend: Spend = { costUsd: 20, costComplete: true, agentMinutes: 90 }

  function input(overrides: Partial<BudgetExhaustionInput> = {}): BudgetExhaustionInput {
    return {
      about: 'implement',
      spend,
      budgets: DEFAULT_BUDGETS,
      reached: ['max_cost_usd'],
      ...overrides,
    }
  }

  test('offers one raise option per reached budget, plus cancel — no bare continue', () => {
    const decision = budgetExhaustionDecision(input({ reached: ['max_cost_usd'] }))
    expect(decision.options.map((option) => option.id)).toEqual([
      budgetRaiseOptionId('max_cost_usd'),
      'cancel',
    ])
  })

  test('both budgets reached offers both raise options', () => {
    const decision = budgetExhaustionDecision(
      input({ reached: ['max_cost_usd', 'max_wall_clock_minutes'] }),
    )
    expect(decision.options.map((option) => option.id)).toEqual([
      budgetRaiseOptionId('max_cost_usd'),
      budgetRaiseOptionId('max_wall_clock_minutes'),
      'cancel',
    ])
  })

  test('names the spend against each budget and what was about to run', () => {
    const decision = budgetExhaustionDecision(input({ about: 'code_review' }))
    expect(decision.promptMd).toContain('code_review')
    expect(decision.promptMd).toContain('$20.00')
    expect(decision.promptMd).toContain('90.0')
  })

  test('marks incomplete cost as incomplete, not as a bare number', () => {
    const decision = budgetExhaustionDecision(
      input({ spend: { costUsd: 0, costComplete: false, agentMinutes: 180 } }),
    )
    expect(decision.promptMd).toMatch(/incomplete/i)
  })

  test('is a blocking escalation, engine-raised at the paused state', () => {
    const decision = budgetExhaustionDecision(input())
    expect(decision.kind).toBe('escalation')
    expect(decision.blocking).toBe(true)
    expect(decision.nodeKey).toBe('paused')
    expect(decision.key).toBe('budget-exhausted')
  })
})

describe('budgetFromRaiseOption', () => {
  test('recognizes both raise option ids', () => {
    expect(budgetFromRaiseOption(budgetRaiseOptionId('max_cost_usd'))).toBe('max_cost_usd')
    expect(budgetFromRaiseOption(budgetRaiseOptionId('max_wall_clock_minutes'))).toBe(
      'max_wall_clock_minutes',
    )
  })

  test('any other option id, including cancel, is not a raise', () => {
    expect(budgetFromRaiseOption('cancel')).toBeNull()
    expect(budgetFromRaiseOption('proceed')).toBeNull()
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

describe('partitionRequests', () => {
  function question(key: string, blocking = false): DecisionRequest {
    return { key, kind: 'question', prompt_md: `${key}?`, options: [], blocking }
  }

  test('records every question when the list is within the cap', () => {
    const requests = [question('a'), question('b')]
    const { recorded, refused } = partitionRequests(requests, 3)

    expect(recorded).toEqual(requests)
    expect(refused).toEqual([])
  })

  test('refuses the questions past the cap, keeping the order the stage returned', () => {
    const requests = [question('a'), question('b'), question('c'), question('d')]
    const { recorded, refused } = partitionRequests(requests, 2)

    expect(recorded.map((r) => r.key)).toEqual(['a', 'b'])
    expect(refused.map((r) => r.key)).toEqual(['c', 'd'])
  })

  test('never refuses a blocking request, whatever the cap', () => {
    const requests = [question('a'), question('blocker', true), question('b'), question('c')]
    const { recorded, refused } = partitionRequests(requests, 1)

    expect(recorded.map((r) => r.key)).toEqual(['a', 'blocker'])
    expect(refused.map((r) => r.key)).toEqual(['b', 'c'])
  })

  test('a blocking request does not consume the question cap', () => {
    const escalation: DecisionRequest = {
      key: 'stalled',
      kind: 'escalation',
      prompt_md: 'The loop is not converging.',
      options: [],
      blocking: true,
    }
    const { recorded, refused } = partitionRequests([escalation, question('a')], 1)

    expect(recorded.map((r) => r.key)).toEqual(['stalled', 'a'])
    expect(refused).toEqual([])
  })

  test('a cap of zero refuses every question and keeps every blocker', () => {
    const { recorded, refused } = partitionRequests([question('a'), question('b', true)], 0)

    expect(recorded.map((r) => r.key)).toEqual(['b'])
    expect(refused.map((r) => r.key)).toEqual(['a'])
  })
})
