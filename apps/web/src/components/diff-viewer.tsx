interface DiffLine {
  readonly kind: 'meta' | 'hunk' | 'add' | 'remove' | 'context'
  readonly text: string
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

function parseUnifiedDiff(diff: string): DiffLine[] {
  let inHunk = false
  // git always terminates its output with a trailing newline; splitting on
  // it as-is would add one spurious blank line after every real diff.
  const lines = diff.endsWith('\n') ? diff.slice(0, -1) : diff

  return lines.split('\n').map((text) => {
    const kind = classifyLine(text, inHunk)
    if (kind === 'hunk') inHunk = true
    if (kind === 'meta' && text.startsWith('diff --git')) inHunk = false

    return { kind, text }
  })
}

export function DiffViewer({ diff }: { diff: string }) {
  if (!diff.trim()) {
    return <p className="p-5 text-sm text-muted">This file has no textual changes to show.</p>
  }

  return (
    <div className="diff-document">
      {parseUnifiedDiff(diff).map((line, index) => (
        // The diff text has no stable per-line identity of its own; render order never changes.
        // biome-ignore lint/suspicious/noArrayIndexKey: static list, no reordering
        <div key={index} className={`diff-line diff-line-${line.kind}`}>
          {line.text.length > 0 ? line.text : ' '}
        </div>
      ))}
    </div>
  )
}
