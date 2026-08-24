import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Diff } from './diff.tsx'

describe('Diff', () => {
  it('renders a placeholder when the file has no textual changes', () => {
    const rendered = renderToStaticMarkup(<Diff diff="" />)

    expect(rendered).toContain('This file has no textual changes to show.')
  })

  it('classifies the header, hunk marker, additions, deletions, and context', () => {
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

    const rendered = renderToStaticMarkup(<Diff diff={diff} />)

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

  it('classifies a removed/added line whose own content starts with -- or ++ as remove/add, not a header (regression)', () => {
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

    const rendered = renderToStaticMarkup(<Diff diff={diff} />)

    expect(rendered).toContain('<div class="diff-line diff-line-remove">--- a lua comment</div>')
    expect(rendered).toContain('<div class="diff-line diff-line-add">+++ a lua comment</div>')
  })

  it('does not render a spurious blank line for the trailing newline real git output always ends with (regression)', () => {
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

    const rendered = renderToStaticMarkup(<Diff diff={`${diffWithoutTrailingNewline}\n`} />)
    const lineCount = rendered.split('class="diff-line diff-line-').length - 1

    expect(lineCount).toBe(8)
  })

  it('numbers each line from its own side of the hunk when asked', () => {
    const diff = ['@@ -41,7 +41,5 @@', ' kept one', '-gone', '+arrived', ' kept two'].join('\n')

    const rendered = renderToStaticMarkup(<Diff diff={diff} lineNumbers />)

    expect(rendered).toContain('<span class="diff-gutter">41</span> kept one')
    expect(rendered).toContain('<span class="diff-gutter">42</span>-gone')
    expect(rendered).toContain('<span class="diff-gutter">42</span>+arrived')
    expect(rendered).toContain('<span class="diff-gutter">43</span> kept two')
  })

  it('resumes numbering at each hunk rather than counting through the gap', () => {
    const diff = ['@@ -1,2 +1,2 @@', '-a', '+A', '@@ -30,2 +30,2 @@', '-b', '+B'].join('\n')

    const rendered = renderToStaticMarkup(<Diff diff={diff} lineNumbers />)

    expect(rendered).toContain('<span class="diff-gutter">30</span>-b')
    expect(rendered).toContain('<span class="diff-gutter">30</span>+B')
  })

  it('leaves the gutter out entirely unless it is asked for', () => {
    const rendered = renderToStaticMarkup(<Diff diff={'@@ -1 +1 @@\n-a\n+b'} />)

    expect(rendered).not.toContain('diff-gutter')
  })

  it('resets header detection at the start of each file in a multi-file diff', () => {
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

    const rendered = renderToStaticMarkup(<Diff diff={diff} />)

    expect(rendered).toContain('<div class="diff-line diff-line-meta">--- a/b.ts</div>')
    expect(rendered).toContain('<div class="diff-line diff-line-meta">+++ b/b.ts</div>')
  })
})
