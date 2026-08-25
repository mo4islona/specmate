import type { ReadOptions, UnreadableReason } from './issues.ts'
import { READABLE_HOST } from './references.ts'

/**
 * What can be learned about a repository without cloning it and without asking
 * a model anything: its default branch, and whether given paths are in its
 * tree. Both are facts with one right answer, which is why no judgement is
 * involved and no token is spent.
 */

export interface RepositoryProbe {
  readonly owner: string
  readonly repo: string
  readonly defaultBranch: string | null
  readonly isPrivate: boolean | null
  readonly description: string | null
  /** The subset of the requested paths the tree actually holds. */
  readonly presentPaths: readonly string[]
}

export type RepositoryRead =
  | { readonly read: true; readonly detail: RepositoryProbe }
  | { readonly read: false; readonly reason: UnreadableReason; readonly detail: string }

export interface ProbeTarget {
  readonly host: string
  readonly owner: string
  readonly repo: string
  /** Paths whose presence decides something — a specification suite, a manifest. */
  readonly paths: readonly string[]
}

const API_ROOT = 'https://api.github.com'

/** Long enough to survive a burst of typing about one repository, short enough to notice a push. */
const PROBE_TTL_MS = 5 * 60_000
const MISS_TTL_MS = 30_000

function headers(token: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

/**
 * A path's presence, from the contents endpoint. A 404 is the answer "no",
 * which is different from "could not tell" — the caller must not read a failed
 * lookup as an absent suite, or a rate limit would quietly reclassify every
 * repository as having no specification.
 */
async function pathExists(
  target: ProbeTarget,
  path: string,
  token: string,
  fetcher: typeof fetch,
): Promise<boolean | null> {
  const url = `${API_ROOT}/repos/${target.owner}/${target.repo}/contents/${path}`
  const response = await fetcher(url, { headers: headers(token) }).catch(() => null)
  if (!response) return null

  if (response.status === 404) return false

  return response.ok ? true : null
}

async function probeOnce(target: ProbeTarget, options: ReadOptions): Promise<RepositoryRead> {
  if (target.host !== READABLE_HOST) {
    return { read: false, reason: 'unsupported_host', detail: 'not a GitHub repository' }
  }

  const token = await options.token().catch(() => null)
  if (!token) {
    return { read: false, reason: 'no_credential', detail: 'no GitHub authorization is stored' }
  }

  const fetcher = options.fetch ?? fetch
  const [meta, ...found] = await Promise.all([
    fetcher(`${API_ROOT}/repos/${target.owner}/${target.repo}`, {
      headers: headers(token),
    }).catch(() => null),
    ...target.paths.map((path) => pathExists(target, path, token, fetcher)),
  ])

  if (!meta) {
    return { read: false, reason: 'unavailable', detail: 'GitHub could not be reached' }
  }

  if (!meta.ok) {
    const reason: UnreadableReason = meta.status === 404 ? 'not_found' : 'unavailable'

    return {
      read: false,
      reason,
      detail:
        reason === 'not_found'
          ? 'not found, or not visible to the stored authorization'
          : 'GitHub could not be reached',
    }
  }

  const body = (await meta.json().catch(() => null)) as Record<string, unknown> | null

  return {
    read: true,
    detail: {
      owner: target.owner,
      repo: target.repo,
      defaultBranch: typeof body?.default_branch === 'string' ? body.default_branch : null,
      isPrivate: typeof body?.private === 'boolean' ? body.private : null,
      description: typeof body?.description === 'string' ? body.description : null,
      presentPaths: target.paths.filter((_path, index) => found[index] === true),
    },
  }
}

interface ProbeEntry {
  readonly expiresAt: number
  readonly value: Promise<RepositoryRead>
}

/**
 * One probe per repository per window, shared by everyone asking at once —
 * the same shape `ReferenceReader` uses, and for the same reason: a debounced
 * field asks repeatedly and none of those asks should reach GitHub twice.
 */
export class RepositoryProber {
  private readonly entries = new Map<string, ProbeEntry>()

  constructor(private readonly options: ReadOptions) {}

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }

  probe(target: ProbeTarget): Promise<RepositoryRead> {
    const key = `${target.host}/${target.owner}/${target.repo}:${[...target.paths]
      .sort()
      .join(',')}`.toLowerCase()
    const cached = this.entries.get(key)
    if (cached && cached.expiresAt > this.now()) return cached.value

    const value = probeOnce(target, this.options)
    this.entries.set(key, { expiresAt: this.now() + PROBE_TTL_MS, value })

    void value
      .then((result) => {
        if (result.read) return

        this.entries.set(key, { expiresAt: this.now() + MISS_TTL_MS, value })
      })
      .catch(() => this.entries.delete(key))

    return value
  }
}
