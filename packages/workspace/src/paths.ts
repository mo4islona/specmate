import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { normalizeRemote } from '@specmate/core'
import type { WorkspaceConfig } from './config.ts'

export const CHANGES_ROOT = 'openspec/changes'
export const SCHEMA_MARKER = '.openspec.yaml'
/** The decision log: the one artifact no role may author — see `writeDecisionLog`. */
export const DECISION_LOG_FILE = 'decisions.md'
/** Written by an agent run, read by the orchestrator, never committed. */
export const RESULT_FILE = 'RESULT.json'
/** Per-stage logs and other runner scratch. */
export const SCRATCH_DIR = '.specmate'
/** Conversational run product, kept inside the per-attempt scratch directory. */
export const CONVERSATION_FILE = 'CONVERSATION.json'

/**
 * A repository's name on disk. Branded rather than a bare `string` because the
 * only thing separating it from the URL it was minted from is which parameter it
 * lands in — and passing the URL where the key belongs is how one repository got
 * two mirrors. The brand is what makes the compiler find every such call.
 */
export type MirrorKey = string & { readonly __mirrorKey: unique symbol }

/**
 * The key a repository that has no record yet will be filed under. Everything
 * else reads the key off the record (D1); this mints one, exactly once.
 *
 * Two remotes can spell the same repository (`git@host:org/repo.git`,
 * `https://host/org/repo`); the readable part is for humans, the digest of the
 * URL as given is what keeps distinct configurations from colliding.
 */
export function mirrorKey(repoUrl: string): MirrorKey {
  const readable = normalizeRemote(repoUrl)
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  const digest = createHash('sha256').update(repoUrl).digest('hex').slice(0, 10)
  return `${readable || 'repo'}-${digest}` as MirrorKey
}

/**
 * A repository as this layer needs it: the remote to talk to, and the name its
 * files are filed under. The two travel together because every mirror operation
 * needs both, and deriving the second from the first is the thing D1 stops.
 */
export interface RepositoryRef {
  readonly repoUrl: string
  readonly mirrorKey: MirrorKey
}

/** A key read back off a repository record, which is the only other place one exists. */
export function recordedMirrorKey(value: string): MirrorKey {
  return value as MirrorKey
}

export { normalizeRemote }

/** Accept the SSH and HTTPS GitHub spellings used by repository remotes. */
export function githubRepository(repoUrl: string): string | undefined {
  const normalized = normalizeRemote(repoUrl)
  const match = normalized.match(/^github\.com\/([^/]+)\/([^/]+)$/)
  if (!match) {
    return undefined
  }

  return `${match[1]}/${match[2]}`
}

/**
 * Where a repository's cache lives. Takes the key the repository *record* carries
 * rather than deriving one from whatever spelling the caller holds (D1) — the
 * digest is over the raw URL, so deriving it here gave one repository two mirrors
 * the moment two tasks named it differently.
 */
export function mirrorPath(config: WorkspaceConfig, mirrorKey: MirrorKey): string {
  return join(config.root, 'mirrors', `${mirrorKey}.git`)
}

export function worktreePath(config: WorkspaceConfig, slug: string): string {
  return join(config.root, 'tasks', slug)
}

/**
 * A repository's memory store, keyed on the same digest the mirror is named by:
 * one repository is one identity on disk and over REST. Beside the mirrors
 * rather than in a volume of its own, because the API and the orchestrator
 * already have this root at the same absolute path.
 */
export function memoryPath(config: WorkspaceConfig, mirrorKey: MirrorKey): string {
  return join(config.root, 'memory', mirrorKey)
}

/** Disposable detached checkout used by one conversation response attempt. */
export function conversationWorktreePath(
  config: WorkspaceConfig,
  slug: string,
  key: string,
): string {
  return join(config.root, 'conversations', slug, key)
}

export function taskBranch(slug: string): string {
  return `task/${slug}`
}

/**
 * Change folder, relative to the working tree root. The name is what planning
 * called the change (REQ-705); the task's slug is the provisional name it
 * stands under until there is one, and stays the name of a task whose planning
 * never declared it.
 */
export function changeDir(slug: string, changeName?: string | null): string {
  return `${CHANGES_ROOT}/${changeName || slug}`
}
