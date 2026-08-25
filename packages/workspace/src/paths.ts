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
 * Two remotes can spell the same repository (`git@host:org/repo.git`,
 * `https://host/org/repo`); the readable part is for humans, the digest of the
 * URL as given is what keeps distinct configurations from colliding.
 */
export function mirrorKey(repoUrl: string): string {
  const readable = normalizeRemote(repoUrl)
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  const digest = createHash('sha256').update(repoUrl).digest('hex').slice(0, 10)
  return `${readable || 'repo'}-${digest}`
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

export function mirrorPath(config: WorkspaceConfig, repoUrl: string): string {
  return join(config.root, 'mirrors', `${mirrorKey(repoUrl)}.git`)
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
export function memoryPath(config: WorkspaceConfig, repoUrl: string): string {
  return join(config.root, 'memory', mirrorKey(repoUrl))
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
