import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { DiffViewer } from './diff-viewer.tsx'

describe('DiffViewer', () => {
  test('renders a placeholder when the file has no textual changes', () => {
    const rendered = renderToStaticMarkup(<DiffViewer diff="" />)

    expect(rendered).toContain('This file has no textual changes to show.')
  })

  test('classifies the header, hunk marker, additions, deletions, and context', () => {
    const diff = [
      'diff --git a/src/thing.ts b/src/thing.ts',
      'index abc1234..def5678 100644',
      '--- a/src/thing.ts',
      '+++ b/src/thing.ts',
      '@@ -1,2 +1,2 @@',
      ' const kept = 1',
      '-const old = 2',
      '+const updated = 2',
    ].join('\n')

    const rendered = renderToStaticMarkup(<DiffViewer diff={diff} />)

    expect(rendered).toContain(
      '<div class="diff-line diff-line-meta">diff --git a/src/thing.ts b/src/thing.ts</div>',
    )
    expect(rendered).toContain(
      '<div class="diff-line diff-line-meta">index abc1234..def5678 100644</div>',
    )
    expect(rendered).toContain('<div class="diff-line diff-line-meta">--- a/src/thing.ts</div>')
    expect(rendered).toContain('<div class="diff-line diff-line-meta">+++ b/src/thing.ts</div>')
    expect(rendered).toContain('<div class="diff-line diff-line-hunk">@@ -1,2 +1,2 @@</div>')
    expect(rendered).toContain('<div class="diff-line diff-line-context"> const kept = 1</div>')
    expect(rendered).toContain('<div class="diff-line diff-line-remove">-const old = 2</div>')
    expect(rendered).toContain('<div class="diff-line diff-line-add">+const updated = 2</div>')
  })

  test('classifies a removed/added line whose own content starts with -- or ++ as remove/add, not a header (regression)', () => {
    const diff = [
      'diff --git a/lib/comment.lua b/lib/comment.lua',
      'index abc1234..def5678 100644',
      '--- a/lib/comment.lua',
      '+++ b/lib/comment.lua',
      '@@ -1,2 +1,2 @@',
      ' context line',
      '--- a lua comment',
      '+++ a lua comment',
    ].join('\n')

    const rendered = renderToStaticMarkup(<DiffViewer diff={diff} />)

    expect(rendered).toContain('<div class="diff-line diff-line-remove">--- a lua comment</div>')
    expect(rendered).toContain('<div class="diff-line diff-line-add">+++ a lua comment</div>')
  })

  test('does not render a spurious blank line for the trailing newline real git output always ends with (regression)', () => {
    const diffWithoutTrailingNewline = [
      'diff --git a/src/thing.ts b/src/thing.ts',
      'index abc1234..def5678 100644',
      '--- a/src/thing.ts',
      '+++ b/src/thing.ts',
      '@@ -1,2 +1,2 @@',
      ' const kept = 1',
      '-const old = 2',
      '+const updated = 2',
    ].join('\n')

    const rendered = renderToStaticMarkup(<DiffViewer diff={`${diffWithoutTrailingNewline}\n`} />)
    const lineCount = rendered.split('class="diff-line diff-line-').length - 1

    expect(lineCount).toBe(8)
  })

  test('resets header detection at the start of each file in a multi-file diff', () => {
    const diff = [
      'diff --git a/a.ts b/a.ts',
      'index abc1234..def5678 100644',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1 +1 @@',
      '-old a',
      '+new a',
      'diff --git a/b.ts b/b.ts',
      'index 1112223..4445556 100644',
      '--- a/b.ts',
      '+++ b/b.ts',
      '@@ -1 +1 @@',
      '-old b',
      '+new b',
    ].join('\n')

    const rendered = renderToStaticMarkup(<DiffViewer diff={diff} />)

    expect(rendered).toContain('<div class="diff-line diff-line-meta">--- a/b.ts</div>')
    expect(rendered).toContain('<div class="diff-line diff-line-meta">+++ b/b.ts</div>')
  })
})
