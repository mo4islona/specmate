import { cx } from './cx.ts'
import { Note } from './note.tsx'

interface DiffLine {
  readonly kind: 'meta' | 'hunk' | 'add' | 'remove' | 'context'
  readonly text: string
  /**
   * One gutter, not two: a removed line is numbered in the file it left, every
   * other line in the file it is in. Null where a line belongs to neither — the
   * headers.
   */
  readonly number: number | null
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

    if (kind === 'remove') return { kind, text, number: before++ }
    if (kind === 'add') return { kind, text, number: after++ }
    if (kind === 'context' && inHunk) {
      before += 1

      return { kind, text, number: after++ }
    }

    return { kind, text, number: null }
  })
}

interface DiffProps {
  readonly diff: string
  /** Off by default: a whole-file diff is read as prose, an edit is read by line. */
  readonly lineNumbers?: boolean
  readonly className?: string
}

/**
 * A unified diff, rendered. The face itself is a stylesheet for content rather
 * than a part anyone assembles — but the component around it is one: two
 * callers now draw a diff, and only one of them wants the file's line numbers
 * beside it.
 */
export function Diff({ diff, lineNumbers = false, className }: DiffProps) {
  if (!diff.trim()) {
    return <Note className="p-5">This file has no textual changes to show.</Note>
  }

  return (
    <div className={cx('diff-document', lineNumbers && 'diff-document-numbered', className)}>
      {parseUnifiedDiff(diff).map((line, index) => (
        // The diff text has no stable per-line identity of its own; render order never changes.
        // biome-ignore lint/suspicious/noArrayIndexKey: static list, no reordering
        <div key={index} className={cx('diff-line', `diff-line-${line.kind}`)}>
          {lineNumbers && <span className="diff-gutter">{line.number ?? ''}</span>}
          {line.text.length > 0 ? line.text : ' '}
        </div>
      ))}
    </div>
  )
}
