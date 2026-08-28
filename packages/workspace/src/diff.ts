import type { WorkspaceConfig } from './config.ts'
import type { Git } from './git.ts'
import { withMirrorLock } from './lock.ts'
import { ensureMirror, resolveBaseCommit } from './mirror.ts'
import { type MirrorKey, mirrorPath, taskBranch } from './paths.ts'

export class TaskBranchMissingError extends Error {
  constructor(
    readonly repoUrl: string,
    readonly branch: string,
  ) {
    super(`branch "${branch}" does not exist on ${repoUrl}`)
    this.name = 'TaskBranchMissingError'
  }
}

export interface TaskDiffRange {
  readonly mirror: string
  /** Merge-base of the task branch and the base branch's current tip. */
  readonly base: string
  readonly tip: string
}

export type DiffFileStatus = 'added' | 'modified' | 'deleted' | 'type-changed'

/**
 * Which half of the task's work a file is: the specification it wrote inside
 * its own change folder, or everything else it changed (REQ-1013).
 */
export type DiffFileGroup = 'spec' | 'code'

export interface DiffFile {
  readonly path: string
  readonly status: DiffFileStatus
  readonly group: DiffFileGroup
  /** `null` for a binary file, which `git diff --numstat` reports as `-`. */
  readonly additions: number | null
  readonly deletions: number | null
}

/** git's own default, so a read that asks for no width sees what it always saw. */
export const DEFAULT_DIFF_CONTEXT = 3

/**
 * The ceiling on how far a reader may widen a hunk (REQ-1013). Wide enough to
 * be the whole of any file worth reading in a browser, which is what makes
 * "expand everything" a width rather than a mode of its own.
 */
export const MAX_DIFF_CONTEXT = 2000

/**
 * The ceiling on how many files one comparison serves. A branch that changed
 * more than this is not something a person reads file by file, and the list
 * alone is then large enough to stop the screen drawing at all — so it is cut
 * here, where the total can still be reported honestly, rather than in a
 * browser that has already been handed the whole of it.
 */
export const MAX_DIFF_FILES = 2000

/**
 * A comparison and what it holds. The tip travels with the files because a
 * reader's marks on them are a claim about this diff and not the next one
 * (REQ-1013/AC-1062).
 */
export interface TaskDiffFiles {
  readonly tip: string
  /** Everything the comparison changed, including whatever the ceiling cut. */
  readonly total: number
  readonly files: DiffFile[]
}

const STATUS_LETTERS: Record<string, DiffFileStatus> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  T: 'type-changed',
}

/**
 * Resolves the same merge-base + branch-tip pair `renderDiff`
 * (`packages/runner/src/prompt.ts`) computes from a live worktree, but reads
 * the mirror's refs directly — no checkout required, so this works whether or
 * not the task's own worktree currently exists (REQ-1013/AC-1037).
 */
export async function resolveTaskDiffRange(
  git: Git,
  config: WorkspaceConfig,
  task: {
    readonly repoUrl: string
    readonly mirrorKey: MirrorKey
    readonly baseBranch: string | null
    readonly slug: string
  },
): Promise<TaskDiffRange> {
  const branch = taskBranch(task.slug)
  // No pinned base means the task was never provisioned, so its own branch does
  // not exist either — the same failure, named where it is true.
  if (task.baseBranch === null) throw new TaskBranchMissingError(task.repoUrl, branch)

  const baseBranch = task.baseBranch
  const repository = { repoUrl: task.repoUrl, mirrorKey: task.mirrorKey }
  const mirror = mirrorPath(config, repository.mirrorKey)

  return withMirrorLock(
    mirror,
    { heartbeatMs: config.lockHeartbeatMs, staleMs: config.lockStaleMs, waitMs: config.lockWaitMs },
    async () => {
      await ensureMirror(git, config, repository)
      const [tip, baseTip] = await Promise.all([
        git.tryInMirror(mirror, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]),
        resolveBaseCommit(git, mirror, task.repoUrl, baseBranch),
      ])
      if (tip.exitCode !== 0 || !tip.stdout.trim()) {
        throw new TaskBranchMissingError(task.repoUrl, branch)
      }

      const mergeBase = await git.inMirror(mirror, ['merge-base', tip.stdout.trim(), baseTip])

      return { mirror, base: mergeBase.stdout.trim(), tip: tip.stdout.trim() }
    },
  )
}

/**
 * Everything a task's branch changed, each file marked with which half of the
 * work it is (REQ-1013). The change folder is grouped rather than withheld: a
 * task between planning and the spec gate has changed nothing else, and a list
 * that hides its only work reads as a list of nothing.
 *
 * `renderDiff` (`packages/runner/src/prompt.ts`) still excludes the folder for
 * the reviewer's prompt — a role reading a code diff wants code. Same split,
 * different question.
 */
export async function taskFilesChanged(
  git: Git,
  range: TaskDiffRange,
  changeDir: string,
): Promise<DiffFile[]> {
  if (range.base === range.tip) return []

  const pathspec = ['--', '.']
  const [numstat, nameStatus] = await Promise.all([
    git.inMirror(range.mirror, [
      'diff',
      '--no-renames',
      '--numstat',
      '-z',
      range.base,
      range.tip,
      ...pathspec,
    ]),
    git.inMirror(range.mirror, [
      'diff',
      '--no-renames',
      '--name-status',
      '-z',
      range.base,
      range.tip,
      ...pathspec,
    ]),
  ])

  const counts = parseNumstat(numstat.stdout)

  const specPrefix = `${changeDir}/`

  return parseNameStatus(nameStatus.stdout).map((entry) => {
    const count = counts.get(entry.path)

    return {
      path: entry.path,
      status: STATUS_LETTERS[entry.status] ?? 'modified',
      group: entry.path.startsWith(specPrefix) ? ('spec' as const) : ('code' as const),
      additions: count?.additions ?? null,
      deletions: count?.deletions ?? null,
    }
  })
}

/**
 * The comparison held to `MAX_DIFF_FILES`.
 *
 * The specification half goes in first and whole. It is a handful of files, and
 * it is the only half a task between planning and the spec gate has — cut in
 * the comparison's own order, it is what a code half running to thousands drops
 * first, since `openspec/` sorts below almost everything. Past the ceiling even
 * that gives way, so the count this returns is one the name can be trusted on.
 */
export function capDiffFiles(files: readonly DiffFile[]): DiffFile[] {
  if (files.length <= MAX_DIFF_FILES) return [...files]

  const specFiles = files.filter((file) => file.group === 'spec').length
  const room: Record<DiffFileGroup, number> = {
    spec: Math.min(specFiles, MAX_DIFF_FILES),
    code: Math.max(MAX_DIFF_FILES - specFiles, 0),
  }

  const kept: DiffFile[] = []
  for (const file of files) {
    if (room[file.group] === 0) continue

    room[file.group] -= 1
    kept.push(file)
  }

  return kept
}

/**
 * How much context a reader asked for, held to what the read will serve: a
 * width past the ceiling is answered with the ceiling rather than refused
 * (REQ-1013/AC-1063), and a width past the file's length is the whole file,
 * which git resolves on its own.
 */
function contextWidth(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) return DEFAULT_DIFF_CONTEXT

  return Math.min(Math.max(Math.trunc(requested), 0), MAX_DIFF_CONTEXT)
}

/**
 * The unified diff for one file, as of the task branch's current tip, with
 * `context` lines around each hunk.
 *
 * `:(literal)` stops git reading `path` as a glob, but a directory-shaped
 * value (`.`, `src`, `src/`) still matches every file under it even in
 * literal mode — that is prefix matching, a separate pathspec behaviour
 * `:(literal)` does not turn off. So the pathspec is checked against
 * `--numstat` first, and only a match of exactly `path` and nothing else is
 * fetched as a patch; anything broader is treated as no match.
 */
export async function taskFileDiff(
  git: Git,
  range: TaskDiffRange,
  path: string,
  context?: number,
): Promise<string> {
  if (range.base === range.tip) return ''

  const pathspec = ['--', `:(literal)${path}`]
  const numstat = await git.inMirror(range.mirror, [
    'diff',
    '--no-renames',
    '--numstat',
    '-z',
    range.base,
    range.tip,
    ...pathspec,
  ])
  const matched = [...parseNumstat(numstat.stdout).keys()]
  if (matched.length !== 1 || matched[0] !== path) return ''

  const result = await git.inMirror(range.mirror, [
    'diff',
    '--no-renames',
    `-U${contextWidth(context)}`,
    range.base,
    range.tip,
    ...pathspec,
  ])

  return result.stdout
}

/**
 * `--numstat -z`: `<added>\t<removed>\t<path>` per NUL-terminated record.
 * Only the first two tabs are structural — a path itself may contain one —
 * so counts and deletions are read up to them and everything after is path.
 */
function parseNumstat(
  raw: string,
): Map<string, { additions: number | null; deletions: number | null }> {
  const counts = new Map<string, { additions: number | null; deletions: number | null }>()
  for (const record of raw.split('\0').filter(Boolean)) {
    const firstTab = record.indexOf('\t')
    const secondTab = record.indexOf('\t', firstTab + 1)
    if (firstTab === -1 || secondTab === -1) continue

    const addedRaw = record.slice(0, firstTab)
    const removedRaw = record.slice(firstTab + 1, secondTab)
    const path = record.slice(secondTab + 1)
    if (!path) continue

    counts.set(path, {
      additions: addedRaw === '-' ? null : Number(addedRaw),
      deletions: removedRaw === '-' ? null : Number(removedRaw),
    })
  }

  return counts
}

/**
 * `--name-status -z`: unlike `--numstat -z`, this NUL-terminates every field,
 * not just the record — so the stream is a flat `status, path, status, path,
 * ...` sequence, read two tokens at a time (never three: `--no-renames`
 * guarantees no rename/copy entry with an extra old-path token).
 */
function parseNameStatus(raw: string): { status: string; path: string }[] {
  const tokens = raw.split('\0').filter((token) => token.length > 0)
  const entries: { status: string; path: string }[] = []
  for (let i = 0; i < tokens.length; i += 2) {
    const status = tokens[i]
    const path = tokens[i + 1]
    if (!status || !path) continue

    entries.push({ status: status[0] ?? 'M', path })
  }

  return entries
}
