import { describe, expect, test } from 'vitest'
import {
  commitUrl,
  pullRequestNumber,
  repoLabel,
  repoWebUrl,
  shortCommit,
  surfaceRef,
} from './repo-link.ts'

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

describe('repoWebUrl', () => {
  test('the repository is somewhere to go, for a host we can address', () => {
    expect(repoWebUrl('git@github.com:acme/specmate.git')).toBe('https://github.com/acme/specmate')
    expect(repoWebUrl('https://gitlab.com/acme/specmate.git')).toBe(
      'https://gitlab.com/acme/specmate',
    )
  })

  test('an unknown host is named but not linked', () => {
    expect(repoWebUrl('https://git.internal/acme/specmate.git')).toBeNull()
  })
})

describe('pullRequestNumber', () => {
  test('a pull request is called by its number', () => {
    expect(pullRequestNumber('https://github.com/acme/specmate/pull/412')).toBe('#412')
    expect(pullRequestNumber('https://gitlab.com/acme/specmate/-/merge_requests/7')).toBe('#7')
  })

  test('a URL with no number in it invents none', () => {
    expect(pullRequestNumber('https://github.com/acme/specmate')).toBeNull()
  })
})

describe('surfaceRef (AC-960)', () => {
  test('the thread and the docs read the repository at one ref; the files are a comparison', () => {
    expect(surfaceRef('thread', 'main')).toBe('main')
    expect(surfaceRef('docs', 'main')).toBe('main')
    expect(surfaceRef('files', 'main')).toBe('main … head')
  })

  test('a base branch not yet resolved says so rather than guessing one', () => {
    expect(surfaceRef('thread', null)).toBe('default branch')
  })
})
