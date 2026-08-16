import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ArtifactMarkdown } from './artifact-markdown.tsx'

describe('ArtifactMarkdown', () => {
  test('supports GFM while leaving raw HTML inert', () => {
    const rendered = renderToStaticMarkup(
      <ArtifactMarkdown content={'| item |\n| --- |\n| ok |\n\n<script>alert(1)</script>'} />,
    )

    expect(rendered).toContain('<table>')
    expect(rendered).not.toContain('<script>')
    expect(rendered).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })
})
