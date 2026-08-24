/**
 * Unified diffs for what a tool use did, built from the CLI's own report of it
 * (REQ-212). The format is git's — `@@` headers and `+`/`-`/space lines — so
 * one renderer serves both this and the task's committed diff.
 */

/** Lines of context kept either side of a change, as git's own default. */
const CONTEXT = 3

/**
 * Past this many changed lines on one side, the two texts are reported as one
 * replacement rather than aligned line by line. The alignment is quadratic, and
 * a rewrite that large is read as a rewrite anyway.
 */
const ALIGN_LIMIT = 600

export interface UnifiedDiff {
  readonly text: string
  readonly additions: number
  readonly deletions: number
}

/**
 * A trailing newline terminates the last line rather than starting an empty
 * one; without this every diff would carry a phantom final line.
 */
export function splitLines(text: string): string[] {
  if (text === '') return []

  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()

  return lines
}

type OpKind = 'equal' | 'delete' | 'insert'

interface Op {
  readonly kind: OpKind
  readonly text: string
  /** 1-based line in the before-text; 0 for an inserted line. */
  readonly before: number
  /** 1-based line in the after-text; 0 for a deleted line. */
  readonly after: number
}

export function unifiedDiff(before: string, after: string): UnifiedDiff {
  const ops = alignLines(splitLines(before), splitLines(after))
  const additions = ops.filter((op) => op.kind === 'insert').length
  const deletions = ops.filter((op) => op.kind === 'delete').length
  if (additions === 0 && deletions === 0) {
    return { text: '', additions: 0, deletions: 0 }
  }

  return { text: renderHunks(ops), additions, deletions }
}

/**
 * Common head and tail are stripped before the quadratic part runs: an edit
 * replacing four lines of a two-thousand-line file leaves four lines to align.
 */
function alignLines(before: readonly string[], after: readonly string[]): Op[] {
  let head = 0
  while (head < before.length && head < after.length && before[head] === after[head]) head += 1

  let tail = 0
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail += 1
  }

  const beforeMiddle = before.slice(head, before.length - tail)
  const afterMiddle = after.slice(head, after.length - tail)

  const ops: Op[] = []
  for (let i = 0; i < head; i += 1) {
    ops.push({ kind: 'equal', text: before[i] ?? '', before: i + 1, after: i + 1 })
  }

  const middle =
    beforeMiddle.length > ALIGN_LIMIT || afterMiddle.length > ALIGN_LIMIT
      ? replaceWholly(beforeMiddle, afterMiddle)
      : alignMiddle(beforeMiddle, afterMiddle)
  for (const op of middle) {
    ops.push({
      kind: op.kind,
      text: op.text,
      before: op.before === 0 ? 0 : op.before + head,
      after: op.after === 0 ? 0 : op.after + head,
    })
  }

  for (let i = 0; i < tail; i += 1) {
    const beforeLine = before.length - tail + i
    const afterLine = after.length - tail + i
    ops.push({
      kind: 'equal',
      text: before[beforeLine] ?? '',
      before: beforeLine + 1,
      after: afterLine + 1,
    })
  }

  return ops
}

function replaceWholly(before: readonly string[], after: readonly string[]): Op[] {
  const deletes = before.map<Op>((text, index) => ({
    kind: 'delete',
    text,
    before: index + 1,
    after: 0,
  }))
  const inserts = after.map<Op>((text, index) => ({
    kind: 'insert',
    text,
    before: 0,
    after: index + 1,
  }))

  return [...deletes, ...inserts]
}

/** Longest common subsequence, walked back into a delete/insert/equal sequence. */
function alignMiddle(before: readonly string[], after: readonly string[]): Op[] {
  const rows = before.length + 1
  const columns = after.length + 1
  const lengths = new Uint32Array(rows * columns)

  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      lengths[i * columns + j] =
        before[i] === after[j]
          ? (lengths[(i + 1) * columns + j + 1] ?? 0) + 1
          : Math.max(lengths[(i + 1) * columns + j] ?? 0, lengths[i * columns + j + 1] ?? 0)
    }
  }

  const ops: Op[] = []
  let i = 0
  let j = 0
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      ops.push({ kind: 'equal', text: before[i] ?? '', before: i + 1, after: j + 1 })
      i += 1
      j += 1

      continue
    }

    // Deletions first on a tie, so a replaced block reads as its removals
    // followed by its additions rather than interleaved.
    if ((lengths[(i + 1) * columns + j] ?? 0) >= (lengths[i * columns + j + 1] ?? 0)) {
      ops.push({ kind: 'delete', text: before[i] ?? '', before: i + 1, after: 0 })
      i += 1
    } else {
      ops.push({ kind: 'insert', text: after[j] ?? '', before: 0, after: j + 1 })
      j += 1
    }
  }

  while (i < before.length) {
    ops.push({ kind: 'delete', text: before[i] ?? '', before: i + 1, after: 0 })
    i += 1
  }
  while (j < after.length) {
    ops.push({ kind: 'insert', text: after[j] ?? '', before: 0, after: j + 1 })
    j += 1
  }

  return ops
}

/**
 * Changed lines carry `CONTEXT` unchanged lines either side; a run of equal
 * lines longer than two contexts is where one hunk ends and the next begins.
 */
function renderHunks(ops: readonly Op[]): string {
  const changed = ops
    .map((op, index) => (op.kind === 'equal' ? -1 : index))
    .filter((index) => index >= 0)

  const groups: { start: number; end: number }[] = []
  for (const index of changed) {
    const last = groups[groups.length - 1]
    if (last && index - last.end <= CONTEXT * 2) {
      last.end = index

      continue
    }

    groups.push({ start: index, end: index })
  }

  return groups
    .map((group) => {
      const from = Math.max(0, group.start - CONTEXT)
      const to = Math.min(ops.length - 1, group.end + CONTEXT)

      return renderHunk(ops.slice(from, to + 1))
    })
    .join('\n')
}

function renderHunk(ops: readonly Op[]): string {
  const beforeLines = ops.filter((op) => op.kind !== 'insert')
  const afterLines = ops.filter((op) => op.kind !== 'delete')
  // An empty side still needs a number, and git writes the line it would start
  // after — 0 when the side has no lines at all.
  const beforeStart = beforeLines[0]?.before ?? 0
  const afterStart = afterLines[0]?.after ?? 0
  const header = `@@ -${beforeStart},${beforeLines.length} +${afterStart},${afterLines.length} @@`
  const body = ops.map((op) => `${MARKERS[op.kind]}${op.text}`)

  return [header, ...body].join('\n')
}

const MARKERS: Record<OpKind, string> = { equal: ' ', delete: '-', insert: '+' }

/**
 * Clamps a diff to a line budget, whole hunks first so what survives still
 * parses. A single hunk longer than the budget is cut inside itself: half a
 * hunk still reads, and the alternative is showing nothing at all.
 */
export function clampDiff(diff: string, maxLines: number): { text: string; clamped: boolean } {
  const lines = diff === '' ? [] : diff.split('\n')
  if (lines.length <= maxLines) return { text: diff, clamped: false }

  return { text: lines.slice(0, maxLines).join('\n'), clamped: true }
}
