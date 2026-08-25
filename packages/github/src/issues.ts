import { type ForgeReference, isReadable, type ReferenceKind } from './references.ts'

/**
 * Reading what a reference points at. Every failure is a value, never a thrown
 * error: nothing about launching a task depends on this succeeding, and a
 * screen that renders a reference as a link with a reason is more use than one
 * that renders an error.
 */

export type UnreadableReason =
  | 'unsupported_host'
  | 'no_credential'
  | 'not_found'
  | 'rate_limited'
  | 'unavailable'

export interface ReferenceDetail {
  readonly kind: ReferenceKind
  readonly owner: string
  readonly repo: string
  readonly number: number
  readonly title: string
  /** `open`, `closed`, or `merged` — a merged pull request is not just a closed one. */
  readonly state: 'open' | 'closed' | 'merged'
  readonly labels: readonly string[]
  readonly author: string | null
  readonly url: string
}

export type ReferenceRead =
  | { readonly read: true; readonly detail: ReferenceDetail }
  | { readonly read: false; readonly reason: UnreadableReason; readonly detail: string }

/** Returns null when nothing is stored, rather than throwing: absent is an answer here. */
export type TokenSource = () => Promise<string | null>

export interface ReadOptions {
  readonly token: TokenSource
  readonly fetch?: typeof fetch
  readonly now?: () => number
}

const API_ROOT = 'https://api.github.com'

/**
 * Long enough that writing a paragraph about one issue costs one lookup, short
 * enough that a title edited on the forge shows up while the tab is still open.
 * A failure is held for a fraction of that: a rate limit and an expired token
 * both recover, and neither should stay wrong for a minute.
 */
const HIT_TTL_MS = 60_000
const MISS_TTL_MS = 15_000

interface GitHubIssue {
  title?: unknown
  state?: unknown
  html_url?: unknown
  labels?: unknown
  user?: unknown
  pull_request?: unknown
}

function unreadable(reason: UnreadableReason, detail: string): ReferenceRead {
  return { read: false, reason, detail }
}

function labelNames(labels: unknown): string[] {
  if (!Array.isArray(labels)) return []

  return labels
    .map((label) => {
      if (typeof label === 'string') return label

      const name = (label as { name?: unknown } | null)?.name

      return typeof name === 'string' ? name : null
    })
    .filter((name): name is string => name !== null)
}

function stateOf(issue: GitHubIssue, kind: ReferenceKind): ReferenceDetail['state'] {
  const pull = issue.pull_request as { merged_at?: unknown } | undefined | null
  if (pull && typeof pull.merged_at === 'string') return 'merged'

  const state = issue.state === 'closed' ? 'closed' : 'open'

  // A shorthand reference guesses `issue`; what came back knows better.
  return kind === 'pull' && state === 'closed' && !pull ? 'closed' : state
}

/**
 * `403` covers both "this credential may not see it" and "you have asked too
 * often". The remaining-quota header is the only thing that tells them apart,
 * and they need different words: one is a permission, the other is a wait.
 */
function refusalReason(response: Response): UnreadableReason {
  if (response.status === 401) return 'no_credential'

  if (response.status === 404) return 'not_found'

  if (response.status === 429) return 'rate_limited'

  if (response.status === 403) {
    return response.headers.get('x-ratelimit-remaining') === '0' ? 'rate_limited' : 'not_found'
  }

  return 'unavailable'
}

const REFUSAL_DETAIL: Record<UnreadableReason, string> = {
  unsupported_host: 'not a GitHub reference',
  no_credential: 'no GitHub authorization is stored',
  not_found: 'not found, or not visible to the stored authorization',
  rate_limited: 'GitHub rate limit reached',
  unavailable: 'GitHub could not be reached',
}

async function fetchReference(
  reference: ForgeReference,
  options: ReadOptions,
): Promise<ReferenceRead> {
  if (!isReadable(reference)) {
    return unreadable('unsupported_host', REFUSAL_DETAIL.unsupported_host)
  }

  const token = await options.token().catch(() => null)
  if (!token) return unreadable('no_credential', REFUSAL_DETAIL.no_credential)

  const url = `${API_ROOT}/repos/${reference.owner}/${reference.repo}/issues/${reference.number}`
  const response = await (options.fetch ?? fetch)(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  }).catch(() => null)

  if (!response) return unreadable('unavailable', REFUSAL_DETAIL.unavailable)

  if (!response.ok) {
    const reason = refusalReason(response)

    return unreadable(reason, REFUSAL_DETAIL[reason])
  }

  const issue = (await response.json().catch(() => null)) as GitHubIssue | null
  if (!issue || typeof issue.title !== 'string') {
    return unreadable('unavailable', REFUSAL_DETAIL.unavailable)
  }

  const author = (issue.user as { login?: unknown } | null)?.login
  const kind: ReferenceKind = issue.pull_request ? 'pull' : reference.kind

  return {
    read: true,
    detail: {
      kind,
      owner: reference.owner,
      repo: reference.repo,
      number: reference.number,
      title: issue.title,
      state: stateOf(issue, kind),
      labels: labelNames(issue.labels),
      author: typeof author === 'string' ? author : null,
      url: typeof issue.html_url === 'string' ? issue.html_url : reference.url,
    },
  }
}

interface CacheEntry {
  readonly expiresAt: number
  readonly value: Promise<ReferenceRead>
}

/**
 * One lookup per reference per window, shared by everyone asking at once.
 * The in-flight promise is cached rather than its result, so a burst from one
 * debounced field collapses onto a single outbound request instead of racing
 * several that each miss the empty cache.
 */
export class ReferenceReader {
  private readonly entries = new Map<string, CacheEntry>()

  constructor(private readonly options: ReadOptions) {}

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }

  read(reference: ForgeReference): Promise<ReferenceRead> {
    const key =
      `${reference.host}/${reference.owner}/${reference.repo}#${reference.number}`.toLowerCase()
    const cached = this.entries.get(key)
    if (cached && cached.expiresAt > this.now()) return cached.value

    const value = fetchReference(reference, this.options)
    // Held only as long as it is worth holding: a failure expires sooner, and
    // a request that never settles must not pin the key forever.
    this.entries.set(key, { expiresAt: this.now() + HIT_TTL_MS, value })

    void value
      .then((result) => {
        if (result.read) return

        this.entries.set(key, { expiresAt: this.now() + MISS_TTL_MS, value })
      })
      .catch(() => this.entries.delete(key))

    return value
  }
}
