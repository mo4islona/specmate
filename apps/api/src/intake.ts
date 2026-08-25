import { repositoryUrlOf } from '@specmate/github'
import { normalizeRemote } from '@specmate/workspace'

/**
 * What a launch has to settle before a task exists. The repository is the only
 * one an agent cannot answer: every stage runs inside a clone of it (REQ-1016).
 * The title is settled here only provisionally — planning replaces it once it
 * has read the repository (REQ-1306).
 */
/**
 * Which of the fixed rules settled it. Carried so the launch screen can say why
 * it is about to run against this repository (REQ-1900); intake itself only
 * cares that one of them did.
 */
export type ResolvedVia = 'chosen' | 'request-url' | 'known-name' | 'default'

/**
 * Why nothing resolved. The two cases carry the same field and mean opposite
 * things: under `ambiguous` the candidates are what the request named, and
 * under `nothing-named` they are merely every repository the system knows,
 * offered because one of them is probably the answer.
 */
export type UnresolvedReason = 'ambiguous' | 'nothing-named'

export type RepositoryResolution =
  | { readonly resolved: true; readonly repoUrl: string; readonly via: ResolvedVia }
  | {
      readonly resolved: false
      readonly reason: UnresolvedReason
      readonly candidates: readonly string[]
    }

export interface ResolveRepositoryInput {
  /** What the create request named outright, if anything. */
  readonly repoUrl?: string
  readonly request: string
  readonly known: readonly string[]
  readonly defaultRepoUrl: string | null
}

const URL_PATTERN = /\b(?:https?:\/\/|ssh:\/\/|git@)[^\s<>"']+/gi

/** Trailing punctuation belongs to the sentence, not to the URL. */
function trimUrl(candidate: string): string {
  return candidate.replace(/[.,;:!?)\]}'"]+$/, '')
}

export function repositoryUrlIn(text: string): string | null {
  const match = text.match(URL_PATTERN)?.[0]

  if (!match) return null

  // A pasted issue link names the repository it lives in rather than a remote,
  // and it is the same reading the rail lists it under — one parse, so the
  // repository named beside the field cannot disagree with the launch.
  return repositoryUrlOf(trimUrl(match))
}

/** The last path segment of the remote — what a person calls the repository. */
export function repositoryName(repoUrl: string): string {
  const segments = normalizeRemote(repoUrl).split('/')

  return segments[segments.length - 1] ?? ''
}

function namedIn(text: string, name: string): boolean {
  if (!name) return false

  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(text)
}

/**
 * Fixed order, and ambiguity never falls through to a default: two known
 * repositories named in one request is a question for the owner, not a coin
 * flip (REQ-1016).
 */
export function resolveRepository(input: ResolveRepositoryInput): RepositoryResolution {
  if (input.repoUrl) return { resolved: true, repoUrl: input.repoUrl, via: 'chosen' }

  const written = repositoryUrlIn(input.request)
  if (written) return { resolved: true, repoUrl: written, via: 'request-url' }

  const candidates = [...new Set(input.known)]
  const named = candidates.filter((repoUrl) => namedIn(input.request, repositoryName(repoUrl)))
  if (named.length === 1 && named[0]) {
    return { resolved: true, repoUrl: named[0], via: 'known-name' }
  }

  if (named.length > 1) return { resolved: false, reason: 'ambiguous', candidates: named }

  if (input.defaultRepoUrl) {
    return { resolved: true, repoUrl: input.defaultRepoUrl, via: 'default' }
  }

  return { resolved: false, reason: 'nothing-named', candidates }
}

/** The title column is not nullable and the slug is cut from it, so intake needs one now. */
const TITLE_MAX = 120

/**
 * A placeholder, not a judgement: the first line of the request, which is where
 * people put the ask. Planning replaces it with a name written by a role that
 * has read the repository, while the slug this produces — the branch and the
 * change folder — stays what it was.
 */
export function deriveTitle(request: string): string {
  const firstLine = request.trim().split('\n')[0] ?? ''
  const collapsed = firstLine.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= TITLE_MAX) return collapsed

  const cut = collapsed.slice(0, TITLE_MAX)
  const lastSpace = cut.lastIndexOf(' ')

  return lastSpace > TITLE_MAX / 2 ? cut.slice(0, lastSpace) : cut
}
