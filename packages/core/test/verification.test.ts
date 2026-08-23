import { describe, expect, test } from 'bun:test'
import type { ReviewFinding } from '../src/result.ts'
import {
  corroborate,
  deriveFindings,
  extractScenarioInventory,
  type MatrixRow,
  parseMatrix,
} from '../src/verification.ts'

describe('extractScenarioInventory', () => {
  test('extracts scenario headers from a fixture change folder', () => {
    const proposalSpec = `## ADDED Requirements

### Requirement: REQ-1 — Something

#### Scenario: AC-1 — First scenario

- **WHEN** x
- **THEN** y

#### Scenario: AC-2 — Second scenario

- **WHEN** x
- **THEN** y
`
    const contractsSpec = `## MODIFIED Requirements

### Requirement: REQ-6 — Other

#### Scenario: AC-12 — Third scenario

- **WHEN** x
- **THEN** y
`
    const inventory = extractScenarioInventory([proposalSpec, contractsSpec])
    expect(inventory).toEqual([
      'AC-1 — First scenario',
      'AC-2 — Second scenario',
      'AC-12 — Third scenario',
    ])
  })

  test('collapses duplicate scenario text within and across files', () => {
    const a = '#### Scenario: AC-1 — Same text\n#### Scenario: AC-1 — Same text\n'
    const b = '#### Scenario: AC-1 — Same text\n'
    expect(extractScenarioInventory([a, b])).toEqual(['AC-1 — Same text'])
  })

  test('ignores headings that are not scenarios', () => {
    const content = '#### Not a scenario\n#### Scenario: AC-1 — Real one\n'
    expect(extractScenarioInventory([content])).toEqual(['AC-1 — Real one'])
  })
})

const CLEAN_MATRIX = `## Matrix

| Scenario | Assertion | Outcome |
| --- | --- | --- |
| AC-1 — First | \`bun test -t AC-1\` | pass |
| AC-2 — Second | \`bun test -t AC-2\` | fail |
`

describe('parseMatrix', () => {
  test('parses a clean table', () => {
    const parsed = parseMatrix(CLEAN_MATRIX)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.rows).toEqual([
      { scenario: 'AC-1 — First', assertion: '`bun test -t AC-1`', outcome: 'pass' },
      { scenario: 'AC-2 — Second', assertion: '`bun test -t AC-2`', outcome: 'fail' },
    ])
  })

  test('tolerates sloppy alignment and extra whitespace', () => {
    const sloppy = `## Matrix
|Scenario   |Assertion|Outcome|
|-----|:---:|---|
|  AC-1 — First   |  \`bun test\`   |   pass   |
`
    const parsed = parseMatrix(sloppy)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.rows).toEqual([
      { scenario: 'AC-1 — First', assertion: '`bun test`', outcome: 'pass' },
    ])
  })

  test('tolerates columns in a different order', () => {
    const reordered = `## Matrix
| Outcome | Scenario | Assertion |
| --- | --- | --- |
| uncovered | AC-3 — Third | — |
`
    const parsed = parseMatrix(reordered)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.rows).toEqual([
      { scenario: 'AC-3 — Third', assertion: '—', outcome: 'uncovered' },
    ])
  })

  test('fails when the "## Matrix" heading is missing', () => {
    const parsed = parseMatrix('## Results\n\n| Scenario | Assertion | Outcome |\n| - | - | - |\n')
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error).toContain('Matrix')
  })

  test('fails on a wrong column set', () => {
    const wrongColumns = `## Matrix
| Scenario | Outcome |
| --- | --- |
| AC-1 — First | pass |
`
    const parsed = parseMatrix(wrongColumns)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error).toContain('column')
  })

  test('fails on a missing separator row', () => {
    const noSeparator = `## Matrix
| Scenario | Assertion | Outcome |
| AC-1 — First | \`bun test\` | pass |
`
    const parsed = parseMatrix(noSeparator)
    expect(parsed.ok).toBe(false)
  })

  test('fails on an unrecognized outcome', () => {
    const badOutcome = `## Matrix
| Scenario | Assertion | Outcome |
| --- | --- | --- |
| AC-1 — First | \`bun test\` | maybe |
`
    const parsed = parseMatrix(badOutcome)
    expect(parsed.ok).toBe(false)
  })

  test('an empty table under the heading is not a parse failure', () => {
    const empty = `## Matrix
| Scenario | Assertion | Outcome |
| --- | --- | --- |
`
    const parsed = parseMatrix(empty)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.rows).toEqual([])
  })
})

describe('corroborate', () => {
  const inventory = ['AC-1 — First', 'AC-2 — Second']

  test('corroborated approve: every scenario covered with all-pass outcomes', () => {
    const matrix: MatrixRow[] = [
      { scenario: 'AC-1 — First', assertion: 'a', outcome: 'pass' },
      { scenario: 'AC-2 — Second', assertion: 'b', outcome: 'pass' },
    ]
    expect(corroborate(inventory, matrix, 'approve')).toEqual({ ok: true, violations: [] })
  })

  test('uncovered scenario fails an approve, naming it', () => {
    const matrix: MatrixRow[] = [{ scenario: 'AC-1 — First', assertion: 'a', outcome: 'pass' }]
    expect(corroborate(inventory, matrix, 'approve')).toEqual({
      ok: false,
      violations: ['AC-2 — Second'],
    })
  })

  test('a scenario absent from the report fails an approve, naming it', () => {
    const matrix: MatrixRow[] = [{ scenario: 'AC-1 — First', assertion: 'a', outcome: 'pass' }]
    const result = corroborate(inventory, matrix, 'approve')
    expect(result.ok).toBe(false)
    expect(result.violations).toContain('AC-2 — Second')
  })

  test('a failing outcome fails an approve, naming the scenario', () => {
    const matrix: MatrixRow[] = [
      { scenario: 'AC-1 — First', assertion: 'a', outcome: 'pass' },
      { scenario: 'AC-2 — Second', assertion: 'b', outcome: 'fail' },
    ]
    expect(corroborate(inventory, matrix, 'approve')).toEqual({
      ok: false,
      violations: ['AC-2 — Second'],
    })
  })

  test('an honest revise passes through uncorroborated', () => {
    const matrix: MatrixRow[] = [{ scenario: 'AC-1 — First', assertion: 'a', outcome: 'fail' }]
    expect(corroborate(inventory, matrix, 'revise')).toEqual({ ok: true, violations: [] })
  })
})

describe('deriveFindings', () => {
  const inventory = ['AC-1 — First', 'AC-2 — Second']

  test('one finding per failing or uncovered scenario, none for a passing one', () => {
    const matrix: MatrixRow[] = [
      { scenario: 'AC-1 — First', assertion: 'a', outcome: 'pass' },
      { scenario: 'AC-2 — Second', assertion: 'b', outcome: 'fail' },
    ]
    const findings = deriveFindings(inventory, matrix, [])
    expect(findings).toHaveLength(1)
    expect(findings[0]?.id).toBe('AC-2')
  })

  test('same fixture yields identical identifiers across two runs', () => {
    const matrix: MatrixRow[] = [{ scenario: 'AC-2 — Second', assertion: 'b', outcome: 'fail' }]
    const first = deriveFindings(inventory, matrix, [])
    const second = deriveFindings(inventory, matrix, [])
    expect(first.map((f) => f.id)).toEqual(second.map((f) => f.id))
  })

  test('an agent finding with an unrelated id survives the merge', () => {
    const matrix: MatrixRow[] = [
      { scenario: 'AC-1 — First', assertion: 'a', outcome: 'pass' },
      { scenario: 'AC-2 — Second', assertion: 'b', outcome: 'fail' },
    ]
    const ownFinding: ReviewFinding = {
      id: 'harness-flaky',
      severity: 'minor',
      title: 'Harness needed a retry',
      detail_md: '',
    }
    const findings = deriveFindings(inventory, matrix, [ownFinding])
    expect(findings.map((f) => f.id).sort()).toEqual(['AC-2', 'harness-flaky'])
  })

  test('a derived finding wins over an agent finding that reused its identifier', () => {
    const matrix: MatrixRow[] = [
      { scenario: 'AC-1 — First', assertion: 'a', outcome: 'pass' },
      { scenario: 'AC-2 — Second', assertion: 'b', outcome: 'fail' },
    ]
    const ownFinding: ReviewFinding = {
      id: 'AC-2',
      severity: 'nit',
      title: 'Agent thinks this is minor',
      detail_md: 'unreliable',
    }
    const findings = deriveFindings(inventory, matrix, [ownFinding])
    expect(findings).toHaveLength(1)
    expect(findings[0]?.severity).toBe('blocking')
  })

  test('a scenario missing from the matrix entirely counts as uncovered', () => {
    const matrix: MatrixRow[] = []
    const findings = deriveFindings(inventory, matrix, [])
    expect(findings.map((f) => f.id).sort()).toEqual(['AC-1', 'AC-2'])
  })
})

describe('what corroboration reaches', () => {
  const inventory = ['AC-1', 'AC-2']
  const allPassing = [
    { scenario: 'AC-1', assertion: 'a.test.ts', outcome: 'pass' as const },
    { scenario: 'AC-2', assertion: 'b.test.ts', outcome: 'pass' as const },
  ]

  test('AC-1113: a revise stands over a fully passing harness', () => {
    // The claim about execution is corroborated; what the stage concluded by
    // reading the diff is a judgement, and a green harness does not overrule it.
    expect(corroborate(inventory, allPassing, 'revise')).toEqual({ ok: true, violations: [] })
    expect(corroborate(inventory, allPassing, 'escalate')).toEqual({ ok: true, violations: [] })
  })

  test('an approve over the same harness is corroborated rather than assumed', () => {
    expect(corroborate(inventory, allPassing, 'approve')).toEqual({ ok: true, violations: [] })
    expect(corroborate([...inventory, 'AC-3'], allPassing, 'approve')).toMatchObject({
      ok: false,
      violations: ['AC-3'],
    })
  })
})
