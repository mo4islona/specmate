import { stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import type { StageActivityEdit } from '@specmate/core'
import { clampDiff, unifiedDiff } from './edit-diff.ts'

/** Lines of diff a timeline read carries per event — the run log's own clamp. */
export const PREVIEW_LINES = 40
/** Lines of diff one event may carry at all. A rewrite says what it is in far less. */
export const PATCH_LINES = 800
/** Files past this are not read to anchor an edit; the edit still travels unanchored. */
const READABLE_BYTES = 2 * 1024 * 1024

interface Replacement {
  readonly old: string
  readonly new: string
  readonly all: boolean
}

/**
 * The two texts an edit is a diff between, and whether they are the file's own
 * — an unanchored pair diffs correctly and cannot say which lines it sits on.
 */
interface EditTexts {
  readonly before: string
  readonly after: string
  readonly anchored: boolean
}

/** Absent and unreadable are different answers: only one of them means "new file". */
type FileRead =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable' }

export interface ToolUse {
  readonly tool: string
  readonly target: string
  readonly input: Record<string, unknown>
}

/**
 * The edit a file-editing tool use is making, as a diff (REQ-212). Every step
 * that can fail degrades to a coarser answer and none of them throws: an event
 * naming the tool is worth more than no event at all (AC-239).
 */
export async function editFor(
  use: ToolUse,
  workspacePath: string,
): Promise<StageActivityEdit | null> {
  const filePath = stringField(use.input, 'file_path')
  if (!filePath) return null

  const path = repoRelative(filePath, workspacePath)
  if (path === null) return null

  const texts = await editTexts(use, resolve(workspacePath, filePath))
  if (texts === null) return null

  const diff = unifiedDiff(texts.before, texts.after)
  if (diff.text === '') return null

  const patch = clampDiff(diff.text, PATCH_LINES)
  const preview = clampDiff(patch.text, PREVIEW_LINES)

  return {
    path,
    additions: diff.additions,
    deletions: diff.deletions,
    preview: preview.text,
    patch: patch.text,
    clamped: preview.clamped,
    truncated: patch.clamped,
    anchored: texts.anchored,
  }
}

/** A path outside the working tree is not this task's to report on. */
function repoRelative(filePath: string, workspacePath: string): string | null {
  const within = relative(workspacePath, resolve(workspacePath, filePath))
  if (within === '' || within.startsWith('..') || isAbsolute(within)) return null

  return within
}

async function editTexts(use: ToolUse, absolute: string): Promise<EditTexts | null> {
  const content = stringField(use.input, 'content')
  if (content !== null) {
    const file = await readFile(absolute)
    // A file that exists and could not be read would otherwise report its whole
    // content as added, which is a rewrite the tool use never claimed.
    if (file.kind === 'unreadable') return null

    return { before: file.kind === 'text' ? file.text : '', after: content, anchored: true }
  }

  const replacements = replacementsIn(use.input)
  if (replacements.length === 0) return null

  const file = await readFile(absolute)
  if (file.kind !== 'text') return unanchored(replacements)

  return applyToFile(file.text, replacements) ?? unanchored(replacements)
}

/**
 * The file as the CLI reported it about to be, and as it will be. The stream is
 * read alongside the tool actually running, so the file on disk can be either
 * side of the edit: a file that already holds the replacement is the *after*,
 * and reversing the replacement recovers the before.
 */
function applyToFile(file: string, replacements: readonly Replacement[]): EditTexts | null {
  const forward = applied(file, replacements, (replacement) => [replacement.old, replacement.new])
  if (forward !== null) return { before: file, after: forward, anchored: true }

  const reversed = [...replacements].reverse()
  const backward = applied(file, reversed, (replacement) => [replacement.new, replacement.old])

  return backward === null ? null : { before: backward, after: file, anchored: true }
}

/** Every replacement must land, in order; one that does not means this is not that file. */
function applied(
  text: string,
  replacements: readonly Replacement[],
  direction: (replacement: Replacement) => readonly [string, string],
): string | null {
  let current = text
  for (const replacement of replacements) {
    const [from, to] = direction(replacement)
    if (from === '' || !current.includes(from)) return null

    current = replacement.all ? current.replaceAll(from, to) : current.replace(from, to)
  }

  return current
}

/** The edit without the file: a correct diff that cannot say where it sits. */
function unanchored(replacements: readonly Replacement[]): EditTexts {
  return {
    before: replacements.map((replacement) => replacement.old).join('\n'),
    after: replacements.map((replacement) => replacement.new).join('\n'),
    anchored: false,
  }
}

function replacementsIn(input: Record<string, unknown>): Replacement[] {
  const edits = input.edits
  if (Array.isArray(edits)) {
    return edits
      .map((edit) => (isRecord(edit) ? replacementIn(edit) : null))
      .filter((replacement): replacement is Replacement => replacement !== null)
  }

  const single = replacementIn(input)

  return single ? [single] : []
}

function replacementIn(input: Record<string, unknown>): Replacement | null {
  const from = stringField(input, 'old_string')
  const to = stringField(input, 'new_string')
  if (from === null || to === null) return null

  return { old: from, new: to, all: input.replace_all === true }
}

async function readFile(absolute: string): Promise<FileRead> {
  const size = await stat(absolute).then(
    (stats) => (stats.isFile() ? stats.size : -1),
    () => null,
  )
  if (size === null) return { kind: 'absent' }
  if (size < 0 || size > READABLE_BYTES) return { kind: 'unreadable' }

  const text = await Bun.file(absolute)
    .text()
    .catch(() => null)

  return text === null ? { kind: 'unreadable' } : { kind: 'text', text }
}

function stringField(input: Record<string, unknown>, key: string): string | null {
  const value = input[key]

  return typeof value === 'string' ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
