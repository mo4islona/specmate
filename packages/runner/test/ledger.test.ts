import { describe, expect, test } from 'bun:test'
import { DEFAULT_CAPS } from '@specmate/core'
import { type LedgerSnapshot, renderLedger } from '../src/ledger.ts'
import { makeConfig } from './fixtures.ts'

const BASE: LedgerSnapshot = {
  title: 'Fix the reorg bug in the ingester',
  slug: 'fix-reorg',
  type: 'bugfix',
  repoUrl: 'git@example.com:org/ingester.git',
  baseBranch: 'main',
  status: 'research',
  harnessStatus: 'partial',
  caps: { ...DEFAULT_CAPS },
  rounds: [],
  interventions: [],
}

describe('ledger', () => {
  test('states what the task is and where in the loop it is', () => {
    const ledger = renderLedger(makeConfig(), BASE)

    expect(ledger).toContain('Fix the reorg bug in the ingester')
    expect(ledger).toContain('- Base branch: main')
    expect(ledger).toContain('- Current state: research')
    expect(ledger).toContain(
      `- spec: 0 round(s) completed, cap ${DEFAULT_CAPS.max_spec_iterations}`,
    )
  })

  test('says plainly when no review has run', () => {
    expect(renderLedger(makeConfig(), BASE)).toContain('No review has run yet.')
  })

  test('carries the previous round’s findings', () => {
    const ledger = renderLedger(makeConfig(), {
      ...BASE,
      rounds: [
        {
          loop: 'spec',
          round: 1,
          verdict: 'revise',
          findings: [
            {
              id: 'missing-scenario',
              severity: 'blocking',
              title: 'No scenario covers the reorg path',
              detail_md: 'Add one before implementation starts.',
            },
          ],
        },
      ],
    })

    expect(ledger).toContain('- Verdict: revise')
    expect(ledger).toContain('`missing-scenario` (blocking) No scenario covers the reorg path')
    expect(ledger).toContain('- spec: 1 round(s) completed')
  })

  test('carries no transcript of an earlier stage', () => {
    const ledger = renderLedger(makeConfig(), {
      ...BASE,
      rounds: [{ loop: 'spec', round: 1, verdict: 'approve', findings: [] }],
    })

    expect(ledger).toContain('The reviewer recorded no findings.')
    expect(ledger).not.toContain('stdout')
    expect(ledger).not.toContain('$ ')
  })

  test('renders only a confirmed intervention, never its surrounding conversation', () => {
    const ledger = renderLedger(makeConfig(), {
      ...BASE,
      interventions: [
        {
          id: 'intervention-1',
          instruction: 'Use the bounded variant.',
          target: { nodeKey: 'implement' },
        },
      ],
    })

    expect(ledger).toContain('Intervention intervention-1: Use the bounded variant.')
    expect(ledger).not.toContain('Why did we discuss this?')
  })

  test('announces a ledger it had to truncate', () => {
    const findings = Array.from({ length: 200 }, (_, i) => ({
      id: `finding-${i}`,
      severity: 'minor' as const,
      title: 'a repeated finding with a reasonably long title',
      detail_md: 'padding'.repeat(20),
    }))

    const ledger = renderLedger(makeConfig({ ledgerBytesLimit: 1024 }), {
      ...BASE,
      rounds: [{ loop: 'impl', round: 3, verdict: 'revise', findings }],
    })

    expect(ledger).toContain('[truncated: ledger exceeded 1024 bytes')
  })
})
