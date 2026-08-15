import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { type AgentRole, ROLE_CONTRACTS } from '@specmate/core'
import { artifactKindForPath, type Git, type Workspace } from '@specmate/workspace'
import type { RunnerConfig } from './config.ts'
import { truncate } from './truncate.ts'

export class RolePromptMissingError extends Error {
  constructor(
    readonly role: AgentRole,
    readonly path: string,
  ) {
    super(`no prompt file for role "${role}": expected ${path}`)
    this.name = 'RolePromptMissingError'
  }
}

export interface PromptParams {
  readonly role: AgentRole
  readonly workspace: Workspace
  readonly baseBranch: string
  readonly ledger: string
}

/**
 * Four sources and no others: the role's prompt, the artifacts its contract
 * declares it reads, the ledger, and the product-code diff. Assembly happens
 * here rather than in the runner so the container carries the provider CLI and
 * nothing of SpecMate.
 */
export async function assemblePrompt(
  git: Git,
  config: RunnerConfig,
  params: PromptParams,
): Promise<string> {
  const contract = ROLE_CONTRACTS[params.role]
  const rolePromptPath = join(config.rolesDir, `${basename(contract.promptFile)}`)
  const rolePrompt = await readFile(rolePromptPath, 'utf8').catch(() => null)
  if (rolePrompt === null) throw new RolePromptMissingError(params.role, rolePromptPath)

  const artifacts = await collectArtifacts(config, params)
  const diff = await renderDiff(git, config, params)

  const sections = [
    rolePrompt.trimEnd(),
    '',
    '---',
    '',
    '# Task ledger',
    '',
    params.ledger.trimEnd(),
    '',
    '---',
    '',
    '# Change folder',
    '',
    artifacts.length === 0
      ? 'The change folder holds none of the artifacts your role reads yet.'
      : artifacts.join('\n\n'),
    '',
    '---',
    '',
    '# Product code changed on this branch',
    '',
    diff,
    '',
  ]

  return `${sections.join('\n')}\n`
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** Only the kinds the role declares; a kind it does not read is not presented. */
async function collectArtifacts(config: RunnerConfig, params: PromptParams): Promise<string[]> {
  const contract = ROLE_CONTRACTS[params.role]
  const reads = new Set(contract.reads)
  const folder = join(params.workspace.path, params.workspace.changeDir)
  const entries = await readdir(folder, { recursive: true, withFileTypes: true }).catch(() => [])

  const found: { path: string; body: string }[] = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const absolute = join(entry.parentPath, entry.name)
    const withinFolder = relative(folder, absolute)
    const kind = artifactKindForPath(withinFolder)
    if (!kind || !reads.has(kind)) continue
    const body = await readFile(absolute, 'utf8').catch(() => null)
    if (body === null) continue
    const repoPath = `${params.workspace.changeDir}/${withinFolder}`
    found.push({ path: repoPath, body: truncate(body, config.artifactBytesLimit, repoPath) })
  }

  return found
    .sort((a, b) => (a.path < b.path ? -1 : 1))
    .map(({ path, body }) => `## ${path}\n\n${fence(body)}`)
}

/**
 * The change folder is presented as artifacts, filtered by the role; the code
 * is presented as a diff. They do not overlap, so the filter still means
 * something — and a reviewer sees what was written, not only what was claimed.
 */
async function renderDiff(git: Git, config: RunnerConfig, params: PromptParams): Promise<string> {
  const base = await mergeBase(git, params)
  if (!base) return 'No base commit could be resolved, so no diff is available.'

  const pathspec = ['--', '.', `:(exclude)${params.workspace.changeDir}`]
  const cwd = params.workspace.path
  const stat = await git.tryRun(['diff', '--stat', base, 'HEAD', ...pathspec], { cwd })
  const patch = await git.tryRun(['diff', base, 'HEAD', ...pathspec], { cwd })
  if (stat.exitCode !== 0 || patch.exitCode !== 0) {
    return 'The diff could not be computed for this branch.'
  }

  if (!patch.stdout.trim()) return 'No product code has changed on this branch yet.'

  const body = `${stat.stdout.trimEnd()}\n\n${fence(patch.stdout, 'diff')}`

  return truncate(body, config.diffBytesLimit, 'product-code diff')
}

async function mergeBase(git: Git, params: PromptParams): Promise<string | null> {
  const cwd = params.workspace.path
  const remote = `refs/remotes/origin/${params.baseBranch}`
  const found = await git.tryRun(['merge-base', 'HEAD', remote], { cwd })
  if (found.exitCode === 0 && found.stdout.trim()) return found.stdout.trim()

  const local = await git.tryRun(['merge-base', 'HEAD', params.baseBranch], { cwd })

  return local.exitCode === 0 && local.stdout.trim() ? local.stdout.trim() : null
}

/** Long enough not to be closed by a fence inside the content it wraps. */
function fence(body: string, language = 'markdown'): string {
  return `\`\`\`\`\`\`${language}\n${body.trimEnd()}\n\`\`\`\`\`\``
}
