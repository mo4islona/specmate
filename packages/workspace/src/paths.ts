import { createHash } from 'node:crypto'
import { join } from 'node:path'
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

function normalizeRemote(repoUrl: string): string {
  const trimmed = repoUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
  const withoutScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^[^/@]+@/, '')
  return withoutScheme.replace(':', '/').toLowerCase()
}

export function mirrorPath(config: WorkspaceConfig, repoUrl: string): string {
  return join(config.root, 'mirrors', `${mirrorKey(repoUrl)}.git`)
}

export function worktreePath(config: WorkspaceConfig, slug: string): string {
  return join(config.root, 'tasks', slug)
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

/** Change folder, relative to the working tree root. */
export function changeDir(slug: string): string {
  return `${CHANGES_ROOT}/${slug}`
}
