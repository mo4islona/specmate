import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
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
    expect(rendered).toContain('<div class="diff-line diff-line-context"> const kept = 1</div>')
    expect(rendered).toContain('<div class="diff-line diff-line-remove">-const old = 2</div>')
    expect(rendered).toContain('<div class="diff-line diff-line-add">+const updated = 2</div>')
  })

  it("drops git's preamble where the surface has already named the file", () => {
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

    const rendered = renderToStaticMarkup(<Diff diff={diff} fileHeader={false} />)

    expect(rendered).not.toContain('diff-line-meta')
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

    // Seven, not eight: the hunk header opens at line 1 and so hides nothing.
    expect(lineCount).toBe(7)
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

describe('Diff, read as two columns', () => {
  it('pairs a removed line with the one that replaced it', () => {
    const diff = ['@@ -1,2 +1,2 @@', ' kept', '-gone', '+arrived'].join('\n')

    const rendered = renderToStaticMarkup(<Diff diff={diff} view="split" lineNumbers />)

    // One row carries both sides: the line as it left on the left, its
    // replacement on the right, each numbered in the file it belongs to.
    expect(rendered).toContain(
      '<span class="diff-gutter">2</span><div class="diff-line diff-line-remove">-gone</div>' +
        '<span class="diff-gutter">2</span><div class="diff-line diff-line-add">+arrived</div>',
    )
  })

  it('leaves the shorter side empty when a hunk removes and adds unequally', () => {
    const diff = ['@@ -1,3 +1,2 @@', '-one', '-two', '+only'].join('\n')

    const rendered = renderToStaticMarkup(<Diff diff={diff} view="split" />)
    const rows = rendered.split('class="diff-row').length - 1

    // Two removals against one addition is two rows, the second with nothing on
    // its right rather than an invented counterpart. The header hides nothing
    // and so is not a row at all.
    expect(rows).toBe(2)
    expect(rendered).toContain('diff-line-absent')
  })

  it('draws an add-only hunk with nothing on the left', () => {
    const diff = ['@@ -0,0 +1,2 @@', '+first', '+second'].join('\n')

    const rendered = renderToStaticMarkup(<Diff diff={diff} view="split" />)

    expect(rendered).toContain('<div class="diff-line diff-line-add">+first</div>')
    expect(rendered).toContain('diff-line-absent')
    expect(rendered).not.toContain('diff-line-remove')
  })

  it('spans a break across both columns', () => {
    const diff = ['@@ -10 +10 @@', '-a', '+b', '@@ -40 +40 @@', '-c', '+d'].join('\n')

    const rendered = renderToStaticMarkup(<Diff diff={diff} view="split" />)

    expect(rendered).toContain('diff-row-full')
    expect(rendered).toContain('29 lines')
  })
})

describe('Diff, widening a hunk', () => {
  const twoHunks = [
    '@@ -10,1 +10,1 @@',
    '-first old',
    '+first new',
    '@@ -30,1 +30,1 @@',
    '-second old',
    '+second new',
  ].join('\n')

  /** The same file at full context: every unchanged line, numbered. */
  const wholeFile = [
    '@@ -1,32 +1,32 @@',
    ...Array.from({ length: 9 }, (_, index) => ` line ${index + 1}`),
    '-first old',
    '+first new',
    ...Array.from({ length: 19 }, (_, index) => ` line ${index + 11}`),
    '-second old',
    '+second new',
  ].join('\n')

  it('says how much a break skips where the caller cannot supply the file', () => {
    const rendered = renderToStaticMarkup(<Diff diff={twoHunks} />)

    expect(rendered).not.toContain('diff-expander')
    expect(rendered).toContain('diff-gap')
    expect(rendered).toContain('9 lines')
    // git's own bookkeeping never reaches the page.
    expect(rendered).not.toContain('@@')
  })

  it('draws no row at all for a hunk that hides nothing', () => {
    const rendered = renderToStaticMarkup(<Diff diff={'@@ -1,2 +1,2 @@\n-a\n+b'} />)

    expect(rendered).not.toContain('diff-line-hunk')
    expect(rendered).not.toContain('@@')
  })

  it('says nothing over the first hunk of a patch it cannot open', () => {
    // A stage's edit opens at the line it edited (REQ-915). There is no line of
    // the file above it, so there is nothing for a break to separate — and
    // "49 lines" over the top of it is a fact about a file nobody is reading.
    const rendered = renderToStaticMarkup(<Diff diff={'@@ -50,2 +50,2 @@\n-a\n+b'} />)

    expect(rendered).not.toContain('diff-gap')
    expect(rendered).not.toContain('49 lines')
  })

  it('still offers to open the first hunk where the file can be fetched', () => {
    const rendered = renderToStaticMarkup(
      <Diff diff={'@@ -50,2 +50,2 @@\n-a\n+b'} onWholeFileNeeded={() => {}} />,
    )

    expect(rendered).toContain('diff-expander')
    expect(rendered).toContain('49 lines')
  })

  it('counts a break from the file it belongs to, not the one before it', () => {
    const diff = [
      'diff --git a/a.ts b/a.ts',
      '@@ -1,1 +1,1 @@',
      '-old a',
      '+new a',
      'diff --git a/b.ts b/b.ts',
      '@@ -30,1 +30,1 @@',
      '-old b',
      '+new b',
    ].join('\n')

    const rendered = renderToStaticMarkup(<Diff diff={diff} onWholeFileNeeded={() => {}} />)

    // 29, not 28: the second file's first hunk measures against its own start.
    expect(rendered).toContain('29 lines')
  })

  it('opens one gap and leaves the other closed', async () => {
    render(<Diff diff={twoHunks} wholeFile={wholeFile} lineNumbers />)

    expect(screen.getAllByRole('button')).toHaveLength(2)

    await userEvent.click(screen.getByRole('button', { name: /Show lines 1 to 9/ }))

    expect(screen.getByText(/line 9/)).toBeTruthy()
    // The other gap is untouched: still an offer, not lines.
    expect(screen.getByRole('button', { name: /Show lines 11 to 29/ })).toBeTruthy()
    expect(screen.queryByText(/line 20/)).toBeNull()
  })

  it('asks for the whole file when it is not here yet, and keeps the offer visible', async () => {
    const onWholeFileNeeded = vi.fn()
    render(<Diff diff={twoHunks} onWholeFileNeeded={onWholeFileNeeded} />)

    const gap = screen.getByRole('button', { name: /Show lines 1 to 9/ })
    await userEvent.click(gap)

    expect(onWholeFileNeeded).toHaveBeenCalledOnce()
    expect(gap.getAttribute('aria-busy')).toBe('true')
  })
})
