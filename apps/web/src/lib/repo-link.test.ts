import { describe, expect, test } from 'vitest'
import { commitUrl, repoLabel, shortCommit } from './repo-link.ts'

describe('repoLabel', () => {
  test('reduces a clone URL to what the owner calls the repository', () => {
    expect(repoLabel('https://github.com/acme/specmate.git')).toBe('acme/specmate')
    expect(repoLabel('git@github.com:acme/specmate.git')).toBe('acme/specmate')
  })

  test('an unparseable remote is shown as given rather than mangled', () => {
    expect(repoLabel('/srv/repos/local.git')).toBe('/srv/repos/local.git')
  })
})

describe('commitUrl', () => {
  test('links a commit on a host whose web scheme is known', () => {
    expect(commitUrl('https://github.com/acme/specmate.git', 'abc1234def')).toBe(
      'https://github.com/acme/specmate/commit/abc1234def',
    )
    expect(commitUrl('git@gitlab.com:acme/specmate.git', 'abc1234def')).toBe(
      'https://gitlab.com/acme/specmate/commit/abc1234def',
    )
  })

  test('refuses to guess a URL for an unknown host or a value that is not a sha', () => {
    expect(commitUrl('https://git.internal/acme/specmate.git', 'abc1234def')).toBeNull()
    expect(commitUrl('https://github.com/acme/specmate.git', 'not-a-sha')).toBeNull()
  })
})

test('a commit shows the seven characters people actually quote', () => {
  expect(shortCommit('8578f21ffca22c4ca5782d452468b2a1a56828f0')).toBe('8578f21')
})
