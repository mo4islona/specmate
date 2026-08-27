import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { HarnessBadge } from './harness-badge.tsx'

describe('harness badge', () => {
  it('renders nothing for adequate coverage', () => {
    expect(renderToStaticMarkup(<HarnessBadge status="adequate" />)).toBe('')
  })

  it('renders nothing before planning has classified anything', () => {
    expect(renderToStaticMarkup(<HarnessBadge status="unknown" />)).toBe('')
  })

  it('states a partial gap', () => {
    const rendered = renderToStaticMarkup(<HarnessBadge status="partial" />)

    expect(rendered).toContain('harness gap: partial')
    expect(rendered).toContain('data-harness-status="partial"')
  })

  it('states a missing gap the same way as partial', () => {
    expect(renderToStaticMarkup(<HarnessBadge status="missing" />)).toContain(
      'harness gap: missing',
    )
  })

  it('shows a waiver on the task view without an artifact — REQ-1405, AC-1416', () => {
    const rendered = renderToStaticMarkup(<HarnessBadge status="waived" />)

    expect(rendered).toContain('harness: waived')
    expect(rendered).toContain('data-harness-status="waived"')
  })

  /**
   * The badge qualifies the header's state sentence; it is not a second one.
   * Both readings say what they are in the word, and neither spends a signal
   * colour doing it — see the budget at the top of `index.css`.
   */
  it('tells a waiver from an open gap in the word, not in a colour', () => {
    const waived = renderToStaticMarkup(<HarnessBadge status="waived" />)
    const open = renderToStaticMarkup(<HarnessBadge status="partial" />)

    expect.soft(waived).not.toContain('harness gap')
    expect.soft(open).toContain('harness gap')

    // The tone is the role the badge sets on itself, so this reads what it
    // actually spends rather than which class it happens to be drawn with.
    for (const rendered of [waived, open]) {
      expect.soft(rendered).toContain('--badge-tone:var(--color-muted-foreground)')
      expect.soft(rendered).not.toContain('--color-warning')
      expect.soft(rendered).not.toContain('--color-status-failed')
    }
  })
})
