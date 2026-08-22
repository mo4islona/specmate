import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { HarnessBadge } from './harness-badge.tsx'

describe('harness badge', () => {
  test('renders nothing for adequate coverage', () => {
    expect(renderToStaticMarkup(<HarnessBadge status="adequate" />)).toBe('')
  })

  test('renders nothing before planning has classified anything', () => {
    expect(renderToStaticMarkup(<HarnessBadge status="unknown" />)).toBe('')
  })

  test('states a partial gap, styled for attention', () => {
    const rendered = renderToStaticMarkup(<HarnessBadge status="partial" />)

    expect(rendered).toContain('harness gap: partial')
    expect(rendered).toContain('data-harness-status="partial"')
    expect(rendered).toContain('text-amber')
  })

  test('states a missing gap the same way as partial', () => {
    const rendered = renderToStaticMarkup(<HarnessBadge status="missing" />)

    expect(rendered).toContain('harness gap: missing')
    expect(rendered).toContain('text-amber')
  })

  test('a waiver is visually distinct from an open, undecided gap — REQ-1405, AC-1416', () => {
    const rendered = renderToStaticMarkup(<HarnessBadge status="waived" />)

    expect(rendered).toContain('harness: waived')
    expect(rendered).toContain('data-harness-status="waived"')
    expect(rendered).not.toContain('text-amber')
  })
})
