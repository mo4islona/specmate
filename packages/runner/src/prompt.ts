import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import {
  type AgentRole,
  type ConversationActionOption,
  ROLE_CONTRACTS,
  type RoleContract,
} from '@specmate/core'
import { artifactKindForPath, type Git, type Workspace } from '@specmate/workspace'
import type { RunnerConfig } from './config.ts'
import { renderRejection, type StageRejection } from './rejection.ts'
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
  /**
   * What the attempt just before this one was rejected for, when this run is a
   * retry of it. The ledger carries the same fact across a re-dispatch; this is
   * the channel for a retry the executor makes itself, whose predecessor is not
   * in the database yet (REQ-217).
   */
  readonly rejection?: StageRejection
  readonly conversation?: {
    readonly context: string
    readonly message: string
    readonly resultPath: string
    readonly previousAnchorCommit: string | null
    readonly previousTaskState: string | null
    readonly currentAnchorCommit: string
    readonly currentTaskState: string
    readonly contextPath: 'stored' | 'cached' | 'reconstructed' | 'none'
    readonly actionOptions: readonly ConversationActionOption[]
  }
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
    changeFolderSection(contract, params.workspace.changeDir, artifacts),
    '',
    '---',
    '',
    '# Product code changed on this branch',
    '',
    diff,
    '',
  ]

  if (params.rejection) {
    sections.push(
      '---',
      '',
      '# Your previous attempt',
      '',
      ...renderRejection(params.rejection),
      '',
    )
  }

  if (params.conversation) {
    const delta = await renderConversationDelta(git, config, params)
    sections.push(
      '---',
      '',
      '# Conversation context',
      '',
      params.conversation.context || 'No earlier messages.',
      '',
      '# Task context since the prior response',
      '',
      delta,
      '',
      '# Available conversation actions',
      '',
      renderConversationActionOptions(params.conversation.actionOptions),
      '',
      '# Current owner message',
      '',
      params.conversation.message,
      '',
      `Write the structured conversation result to \`${params.conversation.resultPath}\`.`,
      '',
    )
  }

  return `${sections.join('\n')}\n`
}

/**
 * The folder as a path a run is told to write into, not only as a heading over
 * what is already in it. The one role contracted to name the change otherwise
 * reads its own declaration as the instruction, and writes into the folder it
 * named rather than the one it was given (AC-243).
 */
function changeFolderSection(
  contract: RoleContract,
  changeDir: string,
  artifacts: readonly string[],
): string {
  const contents =
    artifacts.length === 0
      ? 'It holds none of the artifacts your role reads yet.'
      : artifacts.join('\n\n')

  if (contract.writes.length === 0) {
    return `This task's change folder is \`${changeDir}/\`.\n\n${contents}`
  }

  // A role that also writes source must not read this as "everything goes in the
  // change folder" — only the artifacts its contract names do.
  const instruction = contract.writesCode
    ? `This task's artifacts belong in \`${changeDir}/\`, which already exists; product code belongs where the repository already keeps it.`
    : `Write every artifact of this task into \`${changeDir}/\`, which already exists.`
  if (!contract.declaresPlan) return `${instruction}\n\n${contents}`

  const naming =
    'Naming the change is a field on your result — the folder is renamed to what you declare once this stage is accepted, so do not create one yourself.'

  return `${instruction} ${naming}\n\n${contents}`
}

function renderConversationActionOptions(options: readonly ConversationActionOption[]): string {
  if (options.length === 0) {
    return 'No action is available for this task snapshot. Return an empty `actions` array.'
  }

  const rendered = options.map((option) => {
    const skeleton = {
      kind: option.kind,
      target: option.target,
      expectedVersion: option.expectedVersion,
    }

    return [
      `## ${option.kind}`,
      '',
      option.description,
      `Instruction: ${option.instruction}.`,
      'Copy `kind`, `target`, and `expectedVersion` exactly from this skeleton:',
      '',
      fence(JSON.stringify(skeleton, null, 2), 'json'),
    ].join('\n')
  })

  return [
    'Only the action skeletons below are valid for this snapshot. Never invent or alter an identifier.',
    '',
    ...rendered,
  ].join('\n\n')
}

async function renderConversationDelta(
  git: Git,
  config: RunnerConfig,
  params: PromptParams,
): Promise<string> {
  const conversation = params.conversation
  if (!conversation) return ''

  const state = `Task state: ${conversation.previousTaskState ?? 'none'} → ${conversation.currentTaskState}.`
  const path = `Context path: ${conversation.contextPath}. Current commit: ${conversation.currentAnchorCommit}.`
  const previous = conversation.previousAnchorCommit
  if (!previous)
    return `${state}\n${path}\nThis is the first stored task snapshot for the conversation.`
  if (!/^[0-9a-f]{40,64}$/i.test(previous)) {
    return `${state}\n${path}\nThe previous commit anchor is unavailable; current artifacts and product diff are authoritative.`
  }
  if (previous === conversation.currentAnchorCommit) {
    return `${state}\n${path}\nNo committed files changed since the previous response.`
  }

  const changed = await git.tryRun(
    ['diff', '--stat', previous, conversation.currentAnchorCommit, '--'],
    { cwd: params.workspace.path },
  )
  const names = await git.tryRun(
    ['diff', '--name-status', previous, conversation.currentAnchorCommit, '--'],
    { cwd: params.workspace.path },
  )
  if (changed.exitCode !== 0 || names.exitCode !== 0) {
    return `${state}\n${path}\nThe committed delta could not be computed; current artifacts and product diff are authoritative.`
  }
  const body = [changed.stdout.trim(), names.stdout.trim()].filter(Boolean).join('\n\n')

  return `${state}\n${path}\n${truncate(body || 'No committed files changed.', config.diffBytesLimit, 'conversation anchor delta')}`
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
