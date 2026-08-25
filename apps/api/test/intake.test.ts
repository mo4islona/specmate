import { describe, expect, it } from 'bun:test'
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
  it('an explicit field wins over everything the text says', () => {
    const resolution = resolveRepository({
      repoUrl: PORTAL,
      request: `rework the parser in ${SPECMATE}`,
      known: [SPECMATE],
      defaultRepoUrl: SPECMATE,
    })

    expect(resolution).toEqual({ resolved: true, repoUrl: PORTAL, via: 'chosen' })
  })

  it('a URL written in the request is used as written — AC-1047', () => {
    expect(resolve(`please fix the redirect in ${SPECMATE}`)).toEqual({
      resolved: true,
      repoUrl: SPECMATE,
      via: 'request-url',
    })
  })

  it('sentence punctuation is not part of the URL', () => {
    expect(repositoryUrlIn(`fix it in ${SPECMATE}.`)).toBe(SPECMATE)
    expect(repositoryUrlIn(`fix it in (${SPECMATE}), please`)).toBe(SPECMATE)
  })

  it('an ssh remote counts as a URL too', () => {
    expect(resolve(`the parser in ${PORTAL} drops rows`)).toEqual({
      resolved: true,
      repoUrl: PORTAL,
      via: 'request-url',
    })
  })

  it('a pasted issue link resolves to the repository it lives in, not to the issue', () => {
    expect(resolve(`${SPECMATE}/issues/75`)).toEqual({
      resolved: true,
      repoUrl: SPECMATE,
      via: 'request-url',
    })
  })

  it('a pull request link resolves the same way, sentence and all', () => {
    expect(repositoryUrlIn(`have a look at ${SPECMATE}/pull/12, it is the ask`)).toBe(SPECMATE)
  })

  it('a known repository named in the text resolves — AC-1048', () => {
    expect(resolve('the specmate planner asks too many questions', [SPECMATE, PORTAL])).toEqual({
      resolved: true,
      repoUrl: SPECMATE,
      via: 'known-name',
    })
  })

  it('the name has to stand on its own, not sit inside a longer word', () => {
    const resolution = resolve('rework the specmateish prototype', [SPECMATE])

    expect(resolution.resolved).toBe(false)
  })

  it('two known repositories named in one request is a question, not a coin flip — AC-1050', () => {
    const resolution = resolve('move the portal onto the specmate pipeline', [SPECMATE, PORTAL])

    expect(resolution).toEqual({
      resolved: false,
      reason: 'ambiguous',
      candidates: [SPECMATE, PORTAL],
    })
  })

  it('ambiguity does not fall through to the default', () => {
    const resolution = resolve(
      'move the portal onto the specmate pipeline',
      [SPECMATE, PORTAL],
      PORTAL,
    )

    expect(resolution.resolved).toBe(false)
  })

  it('the default carries a request that names nothing — AC-1052', () => {
    expect(resolve('make the retry backoff configurable', [SPECMATE], PORTAL)).toEqual({
      resolved: true,
      repoUrl: PORTAL,
      via: 'default',
    })
  })

  it('nothing to go on leaves the known repositories as candidates — AC-1049', () => {
    expect(resolve('make the retry backoff configurable', [SPECMATE, PORTAL])).toEqual({
      resolved: false,
      reason: 'nothing-named',
      candidates: [SPECMATE, PORTAL],
    })
  })

  it('a fresh install has nothing to offer, and says so rather than failing — AC-1055', () => {
    expect(resolve('make the retry backoff configurable')).toEqual({
      resolved: false,
      reason: 'nothing-named',
      candidates: [],
    })
  })
})

describe('the title intake derives', () => {
  it('is the first line of the request — AC-1056', () => {
    expect(deriveTitle('Fix the login redirect\n\nIt lands on the homepage instead.')).toBe(
      'Fix the login redirect',
    )
  })

  it('collapses the whitespace a pasted line carries', () => {
    expect(deriveTitle('  Fix   the   login    redirect  ')).toBe('Fix the login redirect')
  })

  it('cuts a long first line at a word boundary', () => {
    const long = `${'word '.repeat(40)}end`
    const title = deriveTitle(long)

    expect(title.length).toBeLessThanOrEqual(120)
    expect(title.endsWith('word')).toBe(true)
  })
})
