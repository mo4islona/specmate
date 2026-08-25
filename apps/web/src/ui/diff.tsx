import { useState } from 'react'
import { cx } from './cx.ts'
import { Note } from './note.tsx'

interface DiffLine {
  readonly kind: 'meta' | 'hunk' | 'add' | 'remove' | 'context'
  readonly text: string
  /** Where the line sits in the file it left; null where it is not in that file. */
  readonly before: number | null
  /** Where the line sits in the file it is in; null where it is not in that one. */
  readonly after: number | null
}

/**
 * `--- `/`+++ ` only mark the file header, which appears once per file before
 * its first `@@` hunk. Inside a hunk, content itself may start with those
 * same characters (e.g. a removed line reading `-- a comment` becomes
 * `--- a comment` once git's own `-` prefix is added) — `inHunk` is what
 * keeps that content from being read as a header.
 */
function classifyLine(line: string, inHunk: boolean): DiffLine['kind'] {
  if (line.startsWith('@@')) return 'hunk'
  if (line.startsWith('diff --git')) return 'meta'
  if (
    !inHunk &&
    (line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ '))
  ) {
    return 'meta'
  }
  if (line.startsWith('+')) return 'add'
  if (line.startsWith('-')) return 'remove'

  return 'context'
}

/** `@@ -12,7 +12,9 @@` — the two starts are where the counters resume. */
function hunkStarts(header: string): { before: number; after: number } | null {
  const match = header.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
  if (!match) return null

  return { before: Number(match[1]), after: Number(match[2]) }
}

function parseUnifiedDiff(diff: string): DiffLine[] {
  let inHunk = false
  let before = 0
  let after = 0
  // git always terminates its output with a trailing newline; splitting on
  // it as-is would add one spurious blank line after every real diff.
  const lines = diff.endsWith('\n') ? diff.slice(0, -1) : diff

  return lines.split('\n').map((text) => {
    const kind = classifyLine(text, inHunk)
    if (kind === 'hunk') {
      inHunk = true
      const starts = hunkStarts(text)
      before = starts?.before ?? 0
      after = starts?.after ?? 0
    }
    if (kind === 'meta' && text.startsWith('diff --git')) inHunk = false

    if (kind === 'remove') return { kind, text, before: before++, after: null }
    if (kind === 'add') return { kind, text, before: null, after: after++ }
    if (kind === 'context' && inHunk) return { kind, text, before: before++, after: after++ }

    return { kind, text, before: null, after: null }
  })
}

/**
 * One gutter, not two: a removed line is numbered in the file it left, every
 * other line in the file it is in. Null where a line belongs to neither.
 */
function gutterNumber(line: DiffLine): number | null {
  return line.kind === 'remove' ? line.before : line.after
}

/**
 * The unchanged lines of a whole-file diff, by line number — which is exactly
 * what the stretch between two hunks needs filling with. Read from a diff
 * rather than from the file's own text so there is only ever one account of
 * what the file says.
 */
function unchangedByLine(diff: string): Map<number, string> {
  const lines = new Map<number, string>()
  for (const line of parseUnifiedDiff(diff)) {
    if (line.kind === 'context' && line.after !== null) lines.set(line.after, line.text)
  }

  return lines
}

/** The stretch of unchanged file a hunk header stands in for. */
interface DiffGap {
  readonly from: number
  readonly to: number
}

interface DiffRow {
  readonly line: DiffLine
  /** Set on a hunk header that hides lines above it, which is what makes it an expander. */
  readonly gap: DiffGap | null
  /** True where nothing of this file has been drawn yet, so the gap separates nothing. */
  readonly leading: boolean
  /** Position among the diff's own lines — what a widened gap is remembered by. */
  readonly index: number
}

function toRows(lines: DiffLine[]): DiffRow[] {
  let lastAfter = 0

  return lines.map((line, index) => {
    if (line.kind !== 'hunk') {
      // A new file starts its own count; without this, the second file's first
      // hunk measures its gap against the first file's last line.
      if (line.kind === 'meta' && line.text.startsWith('diff --git')) lastAfter = 0
      if (line.after !== null) lastAfter = line.after

      return { line, gap: null, leading: false, index }
    }

    const leading = lastAfter === 0
    const start = hunkStarts(line.text)?.after ?? 1
    const from = lastAfter + 1
    const to = start - 1

    return { line, gap: to >= from ? { from, to } : null, leading, index }
  })
}

/**
 * The lines a gap hides, drawn as context once a reader widens it. A gap the
 * whole file has nothing for renders as nothing rather than as blank lines.
 */
function revealGap(gap: DiffGap, file: Map<number, string>): DiffLine[] {
  const revealed: DiffLine[] = []
  for (let n = gap.from; n <= gap.to; n++) {
    const text = file.get(n)
    if (text === undefined) continue

    revealed.push({ kind: 'context', text, before: null, after: n })
  }

  return revealed
}

/** A row of the two-column reading: a removed line beside the one that replaced it. */
interface SplitRow {
  readonly left: DiffLine | null
  readonly right: DiffLine | null
  /** A header spans both columns; it belongs to neither side. */
  readonly full: DiffRow | null
}

/**
 * Removes and adds are paired in the order they appear within a hunk, which is
 * the order git wrote them and the only pairing a unified diff justifies. A run
 * longer on one side leaves the other side's cells empty rather than inventing
 * a counterpart.
 */
function toSplitRows(rows: readonly DiffRow[]): SplitRow[] {
  const split: SplitRow[] = []
  let removed: DiffLine[] = []
  let added: DiffLine[] = []

  const flush = () => {
    for (let i = 0; i < Math.max(removed.length, added.length); i++) {
      split.push({ left: removed[i] ?? null, right: added[i] ?? null, full: null })
    }
    removed = []
    added = []
  }

  for (const row of rows) {
    if (row.line.kind === 'remove') {
      removed.push(row.line)
      continue
    }
    if (row.line.kind === 'add') {
      added.push(row.line)
      continue
    }

    flush()

    if (row.line.kind === 'context') split.push({ left: row.line, right: row.line, full: null })
    else split.push({ left: null, right: null, full: row })
  }

  flush()

  return split
}

export type DiffView = 'unified' | 'split'

interface DiffProps {
  readonly diff: string
  /** Off by default: a whole-file diff is read as prose, an edit is read by line. */
  readonly lineNumbers?: boolean
  readonly view?: DiffView
  /**
   * git's `diff --git`/`index`/`---`/`+++` preamble. Off where the surface has
   * already named the file: five lines of header over a one-line change reads
   * as the header being the point.
   */
  readonly fileHeader?: boolean
  /** The same file at full context — what a gap's expander fills itself from. */
  readonly wholeFile?: string
  /** Called when a reader widens a gap and the whole file is not here yet. */
  readonly onWholeFileNeeded?: () => void
  readonly className?: string
}

/**
 * A unified diff, rendered. The face itself is a stylesheet for content rather
 * than a part anyone assembles — but the component around it is one: it reads
 * as one column or two, and its hunk headers widen into the file they stand in
 * for (REQ-916).
 */
export function Diff({
  diff,
  lineNumbers = false,
  view = 'unified',
  fileHeader = true,
  wholeFile,
  onWholeFileNeeded,
  className,
}: DiffProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set())

  if (!diff.trim()) {
    return <Note className="p-5">This file has no textual changes to show.</Note>
  }

  const file = wholeFile ? unchangedByLine(wholeFile) : null

  const widen = (index: number) => {
    setExpanded((current) => new Set(current).add(index))
    if (!wholeFile) onWholeFileNeeded?.()
  }

  const parsed = parseUnifiedDiff(diff)
  const body = fileHeader ? parsed : parsed.filter((line) => line.kind !== 'meta')

  // A gap only offers to open where the caller can actually supply the file.
  // Everywhere else — a stage's edit, a drawer — it still has to say that the
  // lines below it are not the lines above it.
  const expandable = wholeFile !== undefined || onWholeFileNeeded !== undefined

  /**
   * Which hunk headers earn a row.
   *
   * One that hides nothing is `@@ -0,0 +1 @@` over a file's first line: git's
   * own bookkeeping, repeating the gutter beside it. One that hides something
   * before the first line drawn separates nothing — a stage's edit opens at the
   * line it edited, and "49 lines" over the top of it is a fact about a file
   * nobody is reading here. It stays only where it can be opened, which is what
   * makes it an offer rather than a remark.
   */
  const worthARow = (row: DiffRow) =>
    row.line.kind !== 'hunk' || (row.gap !== null && (expandable || !row.leading))

  // A gap the reader asked for but whose lines have not arrived stays an
  // expander, so the ask is still visible while the read is in flight.
  const rows = toRows(body)
    .filter(worthARow)
    .flatMap((row) => {
      if (!row.gap || !expanded.has(row.index) || !file) return [row]

      const revealed = revealGap(row.gap, file)
      if (revealed.length === 0) return [row]

      return revealed.map((line) => ({ line, gap: null, leading: false, index: row.index }))
    })

  const gapRow = (row: DiffRow) => {
    if (!row.gap) return null

    const hidden = row.gap.to - row.gap.from + 1
    const said = `${hidden} ${hidden === 1 ? 'line' : 'lines'}`

    if (!expandable) {
      return (
        <span className="diff-gap">
          <span aria-hidden="true">···</span>
          <span>{said}</span>
        </span>
      )
    }

    return (
      <button
        type="button"
        className="diff-expander"
        aria-busy={expanded.has(row.index) && !wholeFile}
        onClick={() => widen(row.index)}
      >
        <span aria-hidden="true">···</span>
        <span className="sr-only">
          Show lines {row.gap.from} to {row.gap.to}
        </span>
        <span aria-hidden="true">{said}</span>
      </button>
    )
  }

  if (view === 'split') {
    return (
      <div className={cx('diff-document diff-document-split', className)}>
        {toSplitRows(rows).map((row, index) => (
          // The diff text has no stable per-line identity of its own; render order never changes.
          // biome-ignore lint/suspicious/noArrayIndexKey: static list, no reordering
          <div key={index} className={cx('diff-row', lineNumbers && 'diff-row-numbered')}>
            {row.full ? (
              <div className={cx('diff-line', `diff-line-${row.full.line.kind}`, 'diff-row-full')}>
                {gapRow(row.full) ?? (row.full.line.text.length > 0 ? row.full.line.text : ' ')}
              </div>
            ) : (
              <>
                <DiffCell line={row.left} side="before" lineNumbers={lineNumbers} />
                <DiffCell line={row.right} side="after" lineNumbers={lineNumbers} />
              </>
            )}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className={cx('diff-document', lineNumbers && 'diff-document-numbered', className)}>
      {rows.map((row, position) => (
        // The diff text has no stable per-line identity of its own; render order never changes.
        // biome-ignore lint/suspicious/noArrayIndexKey: static list, no reordering
        <div key={position} className={cx('diff-line', `diff-line-${row.line.kind}`)}>
          {lineNumbers && <span className="diff-gutter">{gutterNumber(row.line) ?? ''}</span>}
          {gapRow(row) ?? (row.line.text.length > 0 ? row.line.text : ' ')}
        </div>
      ))}
    </div>
  )
}

function DiffCell({
  line,
  side,
  lineNumbers,
}: {
  readonly line: DiffLine | null
  readonly side: 'before' | 'after'
  readonly lineNumbers: boolean
}) {
  const number = line === null ? null : side === 'before' ? line.before : line.after

  return (
    <>
      {lineNumbers && <span className="diff-gutter">{number ?? ''}</span>}
      <div className={cx('diff-line', line ? `diff-line-${line.kind}` : 'diff-line-absent')}>
        {line && line.text.length > 0 ? line.text : ' '}
      </div>
    </>
  )
}
