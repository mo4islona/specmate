import { describe, expect, test } from 'bun:test'
import { checkBrief, splitBriefSections } from '../src/brief.ts'

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
