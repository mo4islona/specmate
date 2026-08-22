import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import type { DiffFileSummary } from '../lib/api-client.ts'
import { StatCounts } from './files-changed-screen.tsx'

function file(overrides: Partial<DiffFileSummary> = {}): DiffFileSummary {
  return { path: 'src/thing.ts', status: 'modified', additions: 3, deletions: 1, ...overrides }
}

describe('StatCounts', () => {
  test('renders additions and deletions for a text file', () => {
    const rendered = renderToStaticMarkup(
      <StatCounts file={file({ additions: 3, deletions: 1 })} />,
    )

    expect(rendered).toContain('+3')
    expect(rendered).toContain('-1')
  })

  test('labels a binary file instead of rendering null counts as zero', () => {
    const rendered = renderToStaticMarkup(
      <StatCounts file={file({ additions: null, deletions: null })} />,
    )

    expect(rendered).toContain('binary')
    expect(rendered).not.toContain('+null')
  })
})
