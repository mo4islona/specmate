import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { KickoffBrief } from './kickoff-brief.tsx'

const BRIEF = `## What and Why

Fix the login redirect.

## Approach

- Read the redirect config
- Correct the target route

## Key Points

- Risk: low
- Blast radius: login flow only

## Open Questions

No open questions.

## Size

Small; one iteration.
`

describe('KickoffBrief', () => {
  test('accents the key-points block and renders the rest as plain document sections', () => {
    const rendered = renderToStaticMarkup(<KickoffBrief content={BRIEF} />)

    expect(rendered).toContain('border-l-amber')
    // The accented Key Points wrapper carries the risk bullet.
    const accentedIndex = rendered.indexOf('border-l-amber')
    const riskIndex = rendered.indexOf('Risk: low')
    expect(riskIndex).toBeGreaterThan(accentedIndex)

    // Every section still renders somewhere in the document.
    expect(rendered).toContain('Fix the login redirect')
    expect(rendered).toContain('Read the redirect config')
    expect(rendered).toContain('No open questions')
    expect(rendered).toContain('Small; one iteration')
  })

  test('falls back to the raw document when the content has no sections', () => {
    const rendered = renderToStaticMarkup(<KickoffBrief content="plain text, no headings" />)

    expect(rendered).toContain('plain text, no headings')
    expect(rendered).not.toContain('border-l-amber')
  })

  test('accents Key Points even with irregular internal spacing, matching the backend check', () => {
    const rendered = renderToStaticMarkup(
      <KickoffBrief content={BRIEF.replace('## Key Points', '## Key   Points')} />,
    )

    expect(rendered).toContain('border-l-amber')
  })
})
