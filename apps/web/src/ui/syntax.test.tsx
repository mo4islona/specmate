import { render } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'
import { highlightSide, languageOf, loadSyntax } from './syntax.tsx'

// The grammars are fetched by the first diff that comes near the viewport; here
// nothing is on a screen, so they are asked for outright.
beforeAll(() => loadSyntax())

function coloured(lines: readonly string[], language: string | null) {
  return highlightSide(lines, language).map((line) => {
    const { container } = render(<pre>{line}</pre>)

    return [...container.querySelectorAll('span')].map((span) => ({
      role: span.className.replace('syntax-', ''),
      text: span.textContent ?? '',
    }))
  })
}

function textOf(lines: readonly string[], language: string | null): string[] {
  return highlightSide(lines, language).map((line) => {
    const { container } = render(<pre>{line}</pre>)

    return container.textContent ?? ''
  })
}

describe('languageOf', () => {
  it.each([
    ['src/lib/task-thread.ts', 'typescript'],
    ['apps/web/src/ui/diff.tsx', 'tsx'],
    ['package.json', 'json'],
    ['README.md', 'markdown'],
    ['deploy/compose.yml', 'yaml'],
    ['scripts/build.sh', 'bash'],
    ['src/main.rs', 'rust'],
    ['SRC/MAIN.PY', 'python'],
  ])('reads %s as %s', (path, language) => {
    expect(languageOf(path)).toBe(language)
  })

  it.each(['Dockerfile', 'openspec/changes/x/tasks.lock', 'a.zig', ''])(
    'has nothing to say about %s, and says so',
    (path) => {
      expect(languageOf(path)).toBeNull()
    },
  )

  it('is not fooled by a dot in a directory name', () => {
    expect(languageOf('.github/workflows/ci.yml')).toBe('yaml')
    expect(languageOf('some.dir/LICENSE')).toBeNull()
  })
})

describe('highlightSide', () => {
  it('colours the kinds it names and leaves the rest in the reading colour', () => {
    expect(coloured(['const total = 42 // counted'], 'typescript')).toEqual([
      [
        { role: 'keyword', text: 'const' },
        { role: 'punctuation', text: '=' },
        { role: 'number', text: '42' },
        { role: 'comment', text: '// counted' },
      ],
    ])
  })

  /**
   * The whole point of tokenizing a side rather than a line. Read alone, ` * A
   * pie chart, so the mask` is not a comment at all — it colours as an operator,
   * a stray constant and four identifiers, which is what this replaced.
   */
  it('reads a block comment as one comment and not as five lines of code', () => {
    const block = [
      '/**',
      ' * A pie chart releases its axis gutters (issue #75), so the',
      ' * mask must stay off. An explicit fade still paints.',
      ' */',
    ]

    expect(coloured(block, 'tsx')).toEqual([
      [{ role: 'comment', text: '/**' }],
      [{ role: 'comment', text: ' * A pie chart releases its axis gutters (issue #75), so the' }],
      [{ role: 'comment', text: ' * mask must stay off. An explicit fade still paints.' }],
      [{ role: 'comment', text: ' */' }],
    ])
  })

  it('keeps one line per line it was given, and every character on it', () => {
    const lines = ['function load() {', '', `  return read('x') /* why */`, '}']

    expect(textOf(lines, 'tsx')).toEqual(lines)
  })

  it('leaves the lines alone where nothing here reads the language', () => {
    expect(coloured(['const total = 42'], null)).toEqual([[]])
    expect(textOf(['const total = 42'], null)).toEqual(['const total = 42'])
  })

  it('reads a fragment that opens what it never closes without losing the line', () => {
    expect(textOf(['  const x = `unterminated'], 'tsx')).toEqual(['  const x = `unterminated'])
  })
})
