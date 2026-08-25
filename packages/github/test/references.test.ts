import { describe, expect, it } from 'vitest'
import { isReadable, referencesIn, repositoryUrlOf } from '../src/references.ts'

describe('finding what a request points at', () => {
  it('reads an issue URL', () => {
    const [reference] = referencesIn('fix https://github.com/acme/widgets/issues/412 please')

    expect(reference).toMatchObject({
      kind: 'issue',
      host: 'github.com',
      owner: 'acme',
      repo: 'widgets',
      number: 412,
      url: 'https://github.com/acme/widgets/issues/412',
    })
  })

  it('reads shorthand', () => {
    expect(referencesIn('acme/widgets#412 is the one')[0]).toMatchObject({
      owner: 'acme',
      repo: 'widgets',
      number: 412,
    })
  })

  it.each([
    ['a pull request', 'https://github.com/acme/widgets/pull/7', 'pull'],
    ['a merge request', 'https://gitlab.com/acme/widgets/merge_requests/7', 'pull'],
  ])('reads %s', (_name, text, kind) => {
    expect(referencesIn(text)[0]?.kind).toBe(kind)
  })

  it('drops a trailing .git without changing the repository', () => {
    expect(referencesIn('https://github.com/acme/widgets.git/issues/1')[0]?.repo).toBe('widgets')
  })

  it('takes the same reference written twice as one', () => {
    const found = referencesIn('https://github.com/acme/widgets/issues/9 — that is acme/widgets#9')

    expect(found).toHaveLength(1)
  })

  it('keeps several distinct references in the order they appear', () => {
    const found = referencesIn('acme/a#1 then acme/b#2')

    expect(found.map((r) => r.repo)).toEqual(['a', 'b'])
  })

  it.each([
    ['a bare number, which names a different issue in every repository', 'see #412'],
    ['a repository URL with no issue on it', 'https://github.com/acme/widgets'],
    ['a path that is not an issue or a pull request', 'https://github.com/acme/widgets/tree/main'],
  ])('finds nothing in %s', (_name, text) => {
    expect(referencesIn(text)).toEqual([])
  })

  it('marks a link as written and shorthand as guessed', () => {
    const [written] = referencesIn('https://github.com/acme/widgets/issues/1')
    const [guessed] = referencesIn('acme/widgets#2')

    expect(written?.explicit).toBe(true)
    expect(guessed?.explicit).toBe(false)
  })

  // A repository may be named `thing.ts`, so this shape cannot be told from a
  // path by parsing alone. It is found and marked as a guess; what keeps it off
  // the screen is failing to read, not failing to parse.
  it('takes a path fragment as a guess rather than as a written reference', () => {
    expect(referencesIn('the file src/thing.ts#42 moved')[0]).toMatchObject({
      repo: 'thing.ts',
      explicit: false,
    })
  })

  it('reports a host it cannot read without claiming it found nothing', () => {
    const found = referencesIn('https://gitlab.com/acme/widgets/issues/3')

    expect(found).toHaveLength(1)
    expect(found.map((reference) => [reference.host, isReadable(reference)])).toEqual([
      ['gitlab.com', false],
    ])
  })
})

describe('the repository a link points into', () => {
  it.each([
    ['https://github.com/acme/widgets/issues/412', 'https://github.com/acme/widgets'],
    ['https://github.com/acme/widgets/pull/7', 'https://github.com/acme/widgets'],
    ['https://gitlab.com/acme/widgets/merge_requests/3', 'https://gitlab.com/acme/widgets'],
  ])('cuts %s down to what can be cloned', (url, expected) => {
    expect(repositoryUrlOf(url)).toBe(expected)
  })

  it.each([
    'https://github.com/acme/widgets',
    'https://github.com/acme/widgets.git',
    'git@github.com:acme/widgets.git',
    'ssh://git@forge.example.com/acme/widgets.git',
  ])('leaves a remote alone: %s', (url) => {
    expect(repositoryUrlOf(url)).toBe(url)
  })
})
