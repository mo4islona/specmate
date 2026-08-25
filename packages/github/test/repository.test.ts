import { describe, expect, it, vi } from 'vitest'
import { type ProbeTarget, RepositoryProber } from '../src/repository.ts'

const TARGET: ProbeTarget = {
  host: 'github.com',
  owner: 'acme',
  repo: 'widgets',
  paths: ['openspec/specs'],
}

function respond(url: string): Response {
  if (url.endsWith('/contents/openspec/specs')) return new Response('[]', { status: 200 })

  return new Response(
    JSON.stringify({ default_branch: 'trunk', private: false, description: 'Widgets' }),
    { status: 200 },
  )
}

function prober(fetchImpl: typeof fetch, token: string | null = 'gho_token') {
  return new RepositoryProber({ token: async () => token, fetch: fetchImpl })
}

describe('probing a repository nobody has run a task against', () => {
  it('reports the default branch and which of the asked-for paths are there', async () => {
    const fetchImpl = vi.fn(async (url: string) => respond(url))

    const result = await prober(fetchImpl as unknown as typeof fetch).probe(TARGET)

    expect(result).toMatchObject({
      read: true,
      detail: { defaultBranch: 'trunk', isPrivate: false, presentPaths: ['openspec/specs'] },
    })
  })

  it('reports a path the tree does not hold as absent, not as unknown', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes('/contents/') ? new Response('{}', { status: 404 }) : respond(url),
    )

    const result = await prober(fetchImpl as unknown as typeof fetch).probe(TARGET)

    expect(result).toMatchObject({ read: true, detail: { presentPaths: [] } })
  })

  /**
   * The distinction that matters: a rate-limited path lookup must not read as
   * "no suite here", which would quietly reclassify a repository's convention.
   */
  it('does not count a path it could not check as absent-but-known', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes('/contents/') ? new Response('{}', { status: 403 }) : respond(url),
    )

    const result = await prober(fetchImpl as unknown as typeof fetch).probe(TARGET)

    expect(result).toMatchObject({ read: true, detail: { presentPaths: [] } })
  })

  it.each([
    ['nothing stored', null, 'no_credential'],
    ['a repository nobody can see', 'gho_token', 'not_found'],
  ])('answers unreadable for %s', async (_name, token, reason) => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 404 }))

    const result = await prober(fetchImpl as unknown as typeof fetch, token).probe(TARGET)

    expect(result).toMatchObject({ read: false, reason })
  })

  it('refuses a host it does not read without any request leaving', async () => {
    const fetchImpl = vi.fn()

    const result = await prober(fetchImpl as unknown as typeof fetch).probe({
      ...TARGET,
      host: 'gitlab.com',
    })

    expect(result).toMatchObject({ read: false, reason: 'unsupported_host' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('probes one repository once, however often it is asked', async () => {
    const fetchImpl = vi.fn(async (url: string) => respond(url))
    const subject = prober(fetchImpl as unknown as typeof fetch)

    await subject.probe(TARGET)
    await Promise.all([subject.probe(TARGET), subject.probe(TARGET)])

    // One for the repository, one for the single path — and no repeats.
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
