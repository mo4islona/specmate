/**
 * What a request text points at on a forge, found without asking anyone.
 *
 * Parsing is deliberately separate from reading: intake's preview returns every
 * reference it found whether or not the system can fetch it, and a host we do
 * not read still belongs on screen as a link.
 */

export const READABLE_HOST = 'github.com'

export type ReferenceKind = 'issue' | 'pull'

export interface ForgeReference {
  readonly kind: ReferenceKind
  readonly host: string
  readonly owner: string
  readonly repo: string
  readonly number: number
  /** The reference as a person opens it, normalized — never the spelling that was typed. */
  readonly url: string
  /**
   * Written as a link, rather than inferred from shorthand. `owner/repo#1` and a
   * path like `src/thing.ts#1` are the same shape — repository names may contain
   * dots — so shorthand is a guess, and a guess that turns out to name nothing
   * has to be droppable. A link is a statement, and stays on screen even when it
   * cannot be read.
   */
  readonly explicit: boolean
}

/** `github.com/owner/repo/issues/123`, with or without a scheme or a `www.`. */
const URL_REFERENCE =
  /\b(?:https?:\/\/)?(?:www\.)?([a-z0-9.-]+\.[a-z]{2,})\/([\w.-]+)\/([\w.-]+)\/(issues|pull|merge_requests)\/(\d+)\b/gi

/**
 * `owner/repo#123`. The owner and repo are required: a bare `#123` means a
 * different issue in every repository, and guessing which one is exactly the
 * kind of inference intake refuses to make.
 */
const SHORTHAND_REFERENCE = /(^|[\s([])([\w.-]+)\/([\w.-]+)#(\d+)\b/g

const KIND: Record<string, ReferenceKind> = {
  issues: 'issue',
  pull: 'pull',
  merge_requests: 'pull',
}

function referenceUrl(host: string, owner: string, repo: string, path: string, n: number): string {
  return `https://${host}/${owner}/${repo}/${path}/${n}`
}

/** Same reference written twice — as a link and as shorthand — is one reference. */
function key(reference: ForgeReference): string {
  return `${reference.host}/${reference.owner}/${reference.repo}#${reference.number}`.toLowerCase()
}

/**
 * Every issue or pull request the text names, in the order they appear, without
 * duplicates. A trailing `.git` on the repository is dropped — a URL that
 * carries it still names the same repository.
 */
export function referencesIn(text: string): ForgeReference[] {
  const found: ForgeReference[] = []
  const seen = new Set<string>()

  const add = (reference: ForgeReference): void => {
    if (seen.has(key(reference))) return

    seen.add(key(reference))
    found.push(reference)
  }

  for (const match of text.matchAll(URL_REFERENCE)) {
    const [, host, owner, rawRepo, segment, number] = match
    if (!host || !owner || !rawRepo || !segment || !number) continue

    const kind = KIND[segment.toLowerCase()]
    if (!kind) continue

    const repo = rawRepo.replace(/\.git$/i, '')
    add({
      kind,
      host: host.toLowerCase(),
      owner,
      repo,
      number: Number(number),
      url: referenceUrl(host.toLowerCase(), owner, repo, segment.toLowerCase(), Number(number)),
      explicit: true,
    })
  }

  for (const match of text.matchAll(SHORTHAND_REFERENCE)) {
    const [, , owner, rawRepo, number] = match
    if (!owner || !rawRepo || !number) continue

    // Shorthand cannot say which of the two a number is; GitHub redirects
    // `/issues/n` to the pull request when that is what `n` turned out to be.
    const repo = rawRepo.replace(/\.git$/i, '')
    add({
      kind: 'issue',
      host: READABLE_HOST,
      owner,
      repo,
      number: Number(number),
      url: referenceUrl(READABLE_HOST, owner, repo, 'issues', Number(number)),
      explicit: false,
    })
  }

  return found
}

/** Whether this system can read the reference at all, before any request leaves it. */
export function isReadable(reference: ForgeReference): boolean {
  return reference.host === READABLE_HOST
}

/**
 * The repository a link points into, for a link that points at a page inside
 * one. A URL naming no reference is its own answer, so a plain remote — an ssh
 * one, a `.git` one, a forge this does not read — passes through untouched.
 *
 * Intake needs this because a link to an issue is the most natural way to say
 * what the ask is, and the whole of it is not something that can be cloned:
 * `…/wick-charts/issues/75` read as a remote is a repository called `75`.
 */
export function repositoryUrlOf(url: string): string {
  const [reference] = referencesIn(url)

  if (!reference?.explicit) return url

  return `https://${reference.host}/${reference.owner}/${reference.repo}`
}
