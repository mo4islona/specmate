import { describe, expect, it, test } from 'vitest'
import { briefAcceptanceSource, checkBrief, splitBriefSections } from '../src/brief.ts'

const COMPLETE = `## What and Why

Fix the login redirect so it lands on the dashboard, not the homepage.

## Approach

- Read the redirect config
- Correct the target route
- Add a regression test

## Key Points

- Risk: low, isolated to the redirect handler
- Blast radius: login flow only
- Irreversible: none
- Trade-offs: none

## Open Questions

No open questions.

## Size

Small; expected to take one iteration.
`

describe('checkBrief', () => {
  test('passes a brief carrying every required part within the ceiling', () => {
    const result = checkBrief(COMPLETE)

    expect(result.ok).toBe(true)
    expect(result.missing).toEqual([])
  })

  test('names each required part missing in turn', () => {
    for (const heading of ['What and Why', 'Approach', 'Key Points', 'Open Questions', 'Size']) {
      const withoutHeading = COMPLETE.replace(new RegExp(`## ${heading}\\n`), '## Renamed\\n')
      const result = checkBrief(withoutHeading)

      expect(result.ok).toBe(false)
      expect(result.missing).toContain(heading)
    }
  })

  test('treats a present but empty section as missing', () => {
    const withEmptyApproach = COMPLETE.replace(
      /## Approach\n\n- Read the redirect config\n- Correct the target route\n- Add a regression test\n/,
      '## Approach\n\n',
    )

    const result = checkBrief(withEmptyApproach)

    expect(result.ok).toBe(false)
    expect(result.missing).toEqual(['Approach'])
  })

  test('fails on silence about open questions rather than an explicit absence', () => {
    const silentQuestions = COMPLETE.replace(
      /## Open Questions\n\nNo open questions\.\n/,
      '## Open Questions\n\n',
    )

    const result = checkBrief(silentQuestions)

    expect(result.ok).toBe(false)
    expect(result.missing).toEqual(['Open Questions'])
  })

  test('splits every section in document order, heading text as written', () => {
    const sections = splitBriefSections(COMPLETE)

    expect(sections.map((s) => s.heading)).toEqual([
      'What and Why',
      'Approach',
      'Key Points',
      'Open Questions',
      'Size',
    ])
    expect(sections.find((s) => s.heading === 'Key Points')?.body).toContain('Risk: low')
  })

  test('fails a brief that exceeds the configured ceiling', () => {
    const overLong = `${COMPLETE}\n${'padding '.repeat(2000)}`

    const result = checkBrief(overLong, 6_000)

    expect(result.ok).toBe(false)
    expect(result.missing).toEqual([])
    expect(result.bytes).toBeGreaterThan(result.ceilingBytes)
  })

  test('counts a required heading present when an earlier occurrence has content, even if a later repeat is empty', () => {
    const withEmptyRepeat = `${COMPLETE}\n## Approach\n`

    const result = checkBrief(withEmptyRepeat)

    expect(result.ok).toBe(true)
    expect(result.missing).toEqual([])
  })
})

describe('checkBrief coverage rule', () => {
  const WITH_GAP_WARNING = COMPLETE.replace(
    '- Trade-offs: none',
    '- Trade-offs: none\n- Harness gap: no state-level tests touch this path.',
  )

  test('adequate coverage never requires the warning, even silent', () => {
    const result = checkBrief(COMPLETE, undefined, 'adequate')

    expect(result.ok).toBe(true)
    expect(result.coverageWarningMissing).toBe(false)
  })

  test('missing coverage and a silent brief fails, naming the gap', () => {
    const result = checkBrief(COMPLETE, undefined, 'missing')

    expect(result.ok).toBe(false)
    expect(result.coverageWarningMissing).toBe(true)
  })

  test('missing coverage with the gap warning present passes', () => {
    const result = checkBrief(WITH_GAP_WARNING, undefined, 'missing')

    expect(result.ok).toBe(true)
    expect(result.coverageWarningMissing).toBe(false)
  })

  test('partial coverage behaves the same as missing', () => {
    expect(checkBrief(COMPLETE, undefined, 'partial').ok).toBe(false)
    expect(checkBrief(WITH_GAP_WARNING, undefined, 'partial').ok).toBe(true)
  })

  test('unknown coverage always fails, warning or not', () => {
    expect(checkBrief(COMPLETE, undefined, 'unknown').coverageUnknown).toBe(true)
    expect(checkBrief(COMPLETE, undefined, 'unknown').ok).toBe(false)
    expect(checkBrief(WITH_GAP_WARNING, undefined, 'unknown').ok).toBe(false)
  })

  test('the gap warning label is case-insensitive and needs no exact bullet placement', () => {
    const reordered = COMPLETE.replace(
      '- Risk: low, isolated to the redirect handler',
      '- harness GAP: needs an integration test\n- Risk: low, isolated to the redirect handler',
    )
    expect(checkBrief(reordered, undefined, 'missing').ok).toBe(true)
  })

  test('the gap warning bullet is recognized even indented under a parent bullet', () => {
    const indented = COMPLETE.replace(
      '- Trade-offs: none',
      '- Trade-offs: none\n  - Harness gap: needs an integration test',
    )
    expect(checkBrief(indented, undefined, 'missing').ok).toBe(true)
  })

  test('defaults to adequate when no coverage is supplied, unchanged from before this rule existed', () => {
    expect(checkBrief(COMPLETE).ok).toBe(true)
  })
})

describe('splitBriefSections', () => {
  test('keeps text before the first heading rather than dropping it', () => {
    const sections = splitBriefSections(`A stray title line.\n\n${COMPLETE}`)

    expect(sections[0]).toEqual({ heading: '', body: 'A stray title line.' })
    expect(sections.map((s) => s.heading).slice(1)).toEqual([
      'What and Why',
      'Approach',
      'Key Points',
      'Open Questions',
      'Size',
    ])
  })

  test('returns no sections for a document with no heading at all, preamble or not', () => {
    expect(splitBriefSections('plain text, no headings')).toEqual([])
  })

  test('does not treat a whitespace-only "##" line as a heading', () => {
    const withStrayMarker = COMPLETE.replace('## Key Points\n', '## Key Points\n\n##   \n')

    const sections = splitBriefSections(withStrayMarker)

    expect(sections.find((s) => s.heading === '')).toBeUndefined()
    expect(sections.find((s) => s.heading === 'Key Points')?.body).toContain('##')
  })
})

describe("the brief's acceptance list (REQ-1302, REQ-1303)", () => {
  const WITH_ACCEPTANCE = `${COMPLETE}
## Acceptance

#### Scenario: The redirect lands on the dashboard

- **WHEN** a signed-in owner completes login
- **THEN** the browser SHALL land on the dashboard
`

  it('AC-1326: a repository with no suite owes a list, and one scenario satisfies it', () => {
    const result = checkBrief(WITH_ACCEPTANCE, undefined, 'adequate', true)

    expect(result.ok).toBe(true)
    expect(result.acceptanceMissing).toBe(false)
  })

  it('AC-1328: no list under no suite fails the attempt', () => {
    const result = checkBrief(COMPLETE, undefined, 'adequate', true)

    expect(result.ok).toBe(false)
    expect(result.acceptanceMissing).toBe(true)
  })

  it('AC-1328: a heading with no scenario under it fails the same way', () => {
    const empty = `${COMPLETE}
## Acceptance

To be decided during implementation.
`

    expect(checkBrief(empty, undefined, 'adequate', true).acceptanceMissing).toBe(true)
  })

  it('AC-1327: a repository with a suite must not carry a rival list', () => {
    const result = checkBrief(WITH_ACCEPTANCE, undefined, 'adequate', false)

    expect(result.ok).toBe(false)
    expect(result.acceptanceUnexpected).toBe(true)
  })

  it('AC-1327: the check stays silent about the list where a suite exists', () => {
    const result = checkBrief(COMPLETE, undefined, 'adequate', false)

    expect(result.ok).toBe(true)
    expect(result.acceptanceMissing).toBe(false)
    expect(result.acceptanceUnexpected).toBe(false)
  })

  it('reads scenarios from the acceptance section only, never from prose elsewhere', () => {
    const elsewhere = `${COMPLETE}
#### Scenario: Written in the open questions, which is prose
`

    expect(briefAcceptanceSource(elsewhere)).toBe('')
    expect(checkBrief(elsewhere, undefined, 'adequate', true).acceptanceMissing).toBe(true)
  })
})
