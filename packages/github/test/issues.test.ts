import { describe, expect, it, vi } from 'vitest'
import { ReferenceReader } from '../src/issues.ts'
import { type ForgeReference, referencesIn } from '../src/references.ts'

function only(text: string): ForgeReference {
  const [found] = referencesIn(text)
  if (!found) throw new Error(`no reference found in ${text}`)

  return found
}

const ISSUE = only('https://github.com/acme/widgets/issues/412')
const ELSEWHERE = only('https://gitlab.com/acme/widgets/issues/412')

function issueBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    title: 'Login redirect lands on the homepage',
    state: 'open',
    html_url: 'https://github.com/acme/widgets/issues/412',
    labels: [{ name: 'bug' }, { name: 'auth' }],
    user: { login: 'dana' },
    ...overrides,
  })
}

function reader(fetchImpl: typeof fetch, token: string | null = 'gho_token') {
  return new ReferenceReader({ token: async () => token, fetch: fetchImpl })
}

describe('reading a reference', () => {
  it('carries the number, title, state, labels and author — AC-1069', async () => {
    const fetchImpl = vi.fn(async () => new Response(issueBody(), { status: 200 }))

    const result = await reader(fetchImpl as unknown as typeof fetch).read(ISSUE)

    expect(result).toMatchObject({
      read: true,
      detail: {
        number: 412,
        title: 'Login redirect lands on the homepage',
        state: 'open',
        labels: ['bug', 'auth'],
        author: 'dana',
      },
    })
  })

  it('sends the stored authorization and asks for the issue by its parts', async () => {
    const fetchImpl = vi.fn(async () => new Response(issueBody(), { status: 200 }))

    await reader(fetchImpl as unknown as typeof fetch).read(ISSUE)

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.github.com/repos/acme/widgets/issues/412')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer gho_token')
  })

  it('reports a merged pull request as merged, not merely closed', async () => {
    const body = issueBody({ state: 'closed', pull_request: { merged_at: '2026-08-01T00:00:00Z' } })
    const fetchImpl = vi.fn(async () => new Response(body, { status: 200 }))

    const result = await reader(fetchImpl as unknown as typeof fetch).read(ISSUE)

    expect(result).toMatchObject({ read: true, detail: { state: 'merged', kind: 'pull' } })
  })

  it('answers unreadable rather than failing when nothing is stored — AC-1070', async () => {
    const fetchImpl = vi.fn()

    const result = await reader(fetchImpl as unknown as typeof fetch, null).read(ISSUE)

    expect(result).toMatchObject({ read: false, reason: 'no_credential' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each([
    ['a reference nobody can see', 404, {}, 'not_found'],
    ['a rate limit', 403, { 'x-ratelimit-remaining': '0' }, 'rate_limited'],
    ['a refusal that is not a rate limit', 403, { 'x-ratelimit-remaining': '55' }, 'not_found'],
    ['an authorization GitHub rejected', 401, {}, 'no_credential'],
    ['GitHub itself being unwell', 500, {}, 'unavailable'],
  ])('answers unreadable for %s — AC-1071', async (_name, status, headers, reason) => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status, headers }))

    const result = await reader(fetchImpl as unknown as typeof fetch).read(ISSUE)

    expect(result).toMatchObject({ read: false, reason })
  })

  it('answers unreadable when the request never lands — AC-1071', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    })

    const result = await reader(fetchImpl as unknown as typeof fetch).read(ISSUE)

    expect(result).toMatchObject({ read: false, reason: 'unavailable' })
  })

  it('reads one reference once, however often it is asked — AC-1072', async () => {
    const fetchImpl = vi.fn(async () => new Response(issueBody(), { status: 200 }))
    const subject = reader(fetchImpl as unknown as typeof fetch)

    await subject.read(ISSUE)
    await subject.read(ISSUE)
    await Promise.all([subject.read(ISSUE), subject.read(ISSUE)])

    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('collapses a burst of concurrent reads onto one request — AC-1072', async () => {
    const fetchImpl = vi.fn(async () => new Response(issueBody(), { status: 200 }))
    const subject = reader(fetchImpl as unknown as typeof fetch)

    await Promise.all([subject.read(ISSUE), subject.read(ISSUE), subject.read(ISSUE)])

    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('lets a failure go stale sooner than a success', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 404 }))
    let now = 0
    const subject = new ReferenceReader({
      token: async () => 'gho_token',
      fetch: fetchImpl as unknown as typeof fetch,
      now: () => now,
    })

    await subject.read(ISSUE)
    now = 20_000
    await subject.read(ISSUE)

    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('refuses a host it does not read without any request leaving — AC-1073', async () => {
    const fetchImpl = vi.fn()

    const result = await reader(fetchImpl as unknown as typeof fetch).read(ELSEWHERE)

    expect(result).toMatchObject({ read: false, reason: 'unsupported_host' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
