import { describe, expect, test } from 'bun:test'
import { deriveTitle, repositoryUrlIn, resolveRepository } from '../src/intake.ts'

const SPECMATE = 'https://github.com/example/specmate'
const PORTAL = 'git@github.com:example/portal.git'

function resolve(
  request: string,
  known: readonly string[] = [],
  defaultRepoUrl: string | null = null,
) {
  return resolveRepository({ request, known, defaultRepoUrl })
}

describe('the repository a request names', () => {
  test('an explicit field wins over everything the text says', () => {
    const resolution = resolveRepository({
      repoUrl: PORTAL,
      request: `rework the parser in ${SPECMATE}`,
      known: [SPECMATE],
      defaultRepoUrl: SPECMATE,
    })

    expect(resolution).toEqual({ resolved: true, repoUrl: PORTAL })
  })

  test('a URL written in the request is used as written — AC-1047', () => {
    expect(resolve(`please fix the redirect in ${SPECMATE}`)).toEqual({
      resolved: true,
      repoUrl: SPECMATE,
    })
  })

  test('sentence punctuation is not part of the URL', () => {
    expect(repositoryUrlIn(`fix it in ${SPECMATE}.`)).toBe(SPECMATE)
    expect(repositoryUrlIn(`fix it in (${SPECMATE}), please`)).toBe(SPECMATE)
  })

  test('an ssh remote counts as a URL too', () => {
    expect(resolve(`the parser in ${PORTAL} drops rows`)).toEqual({
      resolved: true,
      repoUrl: PORTAL,
    })
  })

  test('a known repository named in the text resolves — AC-1048', () => {
    expect(resolve('the specmate planner asks too many questions', [SPECMATE, PORTAL])).toEqual({
      resolved: true,
      repoUrl: SPECMATE,
    })
  })

  test('the name has to stand on its own, not sit inside a longer word', () => {
    const resolution = resolve('rework the specmateish prototype', [SPECMATE])

    expect(resolution.resolved).toBe(false)
  })

  test('two known repositories named in one request is a question, not a coin flip — AC-1050', () => {
    const resolution = resolve('move the portal onto the specmate pipeline', [SPECMATE, PORTAL])

    expect(resolution).toEqual({ resolved: false, candidates: [SPECMATE, PORTAL] })
  })

  test('ambiguity does not fall through to the default', () => {
    const resolution = resolve(
      'move the portal onto the specmate pipeline',
      [SPECMATE, PORTAL],
      PORTAL,
    )

    expect(resolution.resolved).toBe(false)
  })

  test('the default carries a request that names nothing — AC-1052', () => {
    expect(resolve('make the retry backoff configurable', [SPECMATE], PORTAL)).toEqual({
      resolved: true,
      repoUrl: PORTAL,
    })
  })

  test('nothing to go on leaves the known repositories as candidates — AC-1049', () => {
    expect(resolve('make the retry backoff configurable', [SPECMATE, PORTAL])).toEqual({
      resolved: false,
      candidates: [SPECMATE, PORTAL],
    })
  })

  test('a fresh install has nothing to offer, and says so rather than failing — AC-1055', () => {
    expect(resolve('make the retry backoff configurable')).toEqual({
      resolved: false,
      candidates: [],
    })
  })
})

describe('the title intake derives', () => {
  test('is the first line of the request — AC-1056', () => {
    expect(deriveTitle('Fix the login redirect\n\nIt lands on the homepage instead.')).toBe(
      'Fix the login redirect',
    )
  })

  test('collapses the whitespace a pasted line carries', () => {
    expect(deriveTitle('  Fix   the   login    redirect  ')).toBe('Fix the login redirect')
  })

  test('cuts a long first line at a word boundary', () => {
    const long = `${'word '.repeat(40)}end`
    const title = deriveTitle(long)

    expect(title.length).toBeLessThanOrEqual(120)
    expect(title.endsWith('word')).toBe(true)
  })
})
