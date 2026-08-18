import { describe, expect, test } from 'bun:test'
import { DEFAULT_CAPS } from '@specmate/core'
import { type LedgerSnapshot, renderLedger } from '../src/ledger.ts'
import { makeConfig } from './fixtures.ts'

const BASE: LedgerSnapshot = {
  title: 'Fix the reorg bug in the ingester',
  ask: 'Fix the reorg bug in the ingester',
  slug: 'fix-reorg',
  type: 'bugfix',
  repoUrl: 'git@example.com:org/ingester.git',
  baseBranch: 'main',
  status: 'research',
  harnessStatus: 'partial',
  harnessEvidence: null,
  caps: { ...DEFAULT_CAPS },
  rounds: [],
  interventions: [],
  gateComments: [],
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

  test('renders the request the owner launched the task with', () => {
    const ledger = renderLedger(makeConfig(), {
      ...BASE,
      ask: 'Reorgs deeper than 6 blocks corrupt the balance index; fix the ingester.',
    })

    expect(ledger).toContain(
      '- Ask: Reorgs deeper than 6 blocks corrupt the balance index; fix the ingester.',
    )
  })

  test('falls back to the title as the ask when the task carries no request', () => {
    const ledger = renderLedger(makeConfig(), BASE)

    expect(ledger).toContain('- Ask: Fix the reorg bug in the ingester')
  })

  test('renders both comments from a task redirected twice', () => {
    const ledger = renderLedger(makeConfig(), {
      ...BASE,
      gateComments: [
        { nodeKey: 'human_kickoff_gate', kind: 'redirect', comment: 'Missing the auth case.' },
        { nodeKey: 'human_kickoff_gate', kind: 'redirect', comment: 'Still missing scope.' },
      ],
    })

    expect(ledger).toContain('- At human_kickoff_gate (redirect): Missing the auth case.')
    expect(ledger).toContain('- At human_kickoff_gate (redirect): Still missing scope.')
  })

  test('renders identically across two calls with the same state', () => {
    const snapshot: LedgerSnapshot = {
      ...BASE,
      gateComments: [
        { nodeKey: 'human_kickoff_gate', kind: 'redirect', comment: 'Missing the auth case.' },
      ],
    }

    expect(renderLedger(makeConfig(), snapshot)).toBe(renderLedger(makeConfig(), snapshot))
  })

  test('lets an oversized set of gate comments be cut by the existing byte limiter', () => {
    const gateComments = Array.from({ length: 200 }, (_, i) => ({
      nodeKey: 'human_kickoff_gate',
      kind: 'redirect' as const,
      comment: `redirect comment ${i} ${'padding'.repeat(20)}`,
    }))

    const ledger = renderLedger(makeConfig({ ledgerBytesLimit: 1024 }), { ...BASE, gateComments })

    expect(ledger).toContain('[truncated: ledger exceeded 1024 bytes')
  })

  test('sacrifices the oldest gate comment to truncation, keeping the newest', () => {
    const gateComments = Array.from({ length: 200 }, (_, i) => ({
      nodeKey: 'human_kickoff_gate',
      kind: 'redirect' as const,
      comment: `redirect comment ${i} ${'padding'.repeat(20)}`,
    }))

    const ledger = renderLedger(makeConfig({ ledgerBytesLimit: 1024 }), { ...BASE, gateComments })

    expect(ledger).toContain('redirect comment 199')
    expect(ledger).not.toContain('redirect comment 0 ')
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

  test('states a waived task’s coverage plainly, with its evidence in short form', () => {
    const ledger = renderLedger(makeConfig(), {
      ...BASE,
      harnessStatus: 'waived',
      harnessEvidence: 'No\n  state-level suite   touches this path.',
    })

    expect(ledger).toContain('- Harness coverage: waived — No state-level suite touches this path.')
  })

  test('states coverage with no evidence suffix before any probe has run', () => {
    const ledger = renderLedger(makeConfig(), { ...BASE, harnessStatus: 'unknown' })

    expect(ledger).toContain('- Harness coverage: unknown')
    expect(ledger).not.toContain('- Harness coverage: unknown —')
  })

  test('renders identically across two calls carrying the same evidence', () => {
    const snapshot: LedgerSnapshot = {
      ...BASE,
      harnessStatus: 'missing',
      harnessEvidence: 'Nothing exercises the reorg path end to end.',
    }

    expect(renderLedger(makeConfig(), snapshot)).toBe(renderLedger(makeConfig(), snapshot))
  })
})
