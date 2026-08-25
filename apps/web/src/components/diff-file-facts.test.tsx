import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { DiffFileSummary } from '../lib/api-client.ts'
import { StatCounts } from './diff-file-facts.tsx'

function file(overrides: Partial<DiffFileSummary> = {}): DiffFileSummary {
  return {
    path: 'src/thing.ts',
    status: 'modified',
    group: 'code',
    additions: 3,
    deletions: 1,
    ...overrides,
  }
}

describe('StatCounts', () => {
  it('renders additions and deletions for a text file', () => {
    const rendered = renderToStaticMarkup(
      <StatCounts file={file({ additions: 3, deletions: 1 })} />,
    )

    expect(rendered).toContain('+3')
    // A minus sign rather than a hyphen: it is set beside a `+`, not parsed.
    expect(rendered).toContain('−1')
  })

  it('labels a binary file instead of rendering null counts as zero', () => {
    const rendered = renderToStaticMarkup(
      <StatCounts file={file({ additions: null, deletions: null })} />,
    )

    expect(rendered).toContain('binary')
    expect(rendered).not.toContain('+null')
  })
})
