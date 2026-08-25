import type { DiffFileSummary } from './api-client.ts'

export interface DirectoryGroup {
  /** Where these files live. Empty for the ones at the repository root. */
  readonly directory: string
  readonly files: readonly DiffFileSummary[]
}

/**
 * The comparison as one heading per directory, and never more than that.
 *
 * A real tree was the first shape, and it read as a ladder: folders sort above
 * files at every level, so a change folder's own `proposal.md` appeared *below*
 * the `specs/operator-ui/spec.md` nested two levels deeper than it, and the eye
 * had to fall three rungs and climb back. A task changes two or three
 * directories, not a forest — so the directory is a heading and the file is a
 * row, and there is no third level to lose your place in.
 */
export function groupByDirectory(files: readonly DiffFileSummary[]): DirectoryGroup[] {
  const groups = new Map<string, DiffFileSummary[]>()

  for (const file of files) {
    const cut = file.path.lastIndexOf('/')
    const directory = cut === -1 ? '' : file.path.slice(0, cut)
    const group = groups.get(directory)

    if (group) group.push(file)
    else groups.set(directory, [file])
  }

  // The root first, since it has no heading to read; the rest by name.
  return [...groups]
    .sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
    .map(([directory, group]) => ({
      directory,
      files: [...group].sort((a, b) => a.path.localeCompare(b.path)),
    }))
}

/** The last segment; the directory above it is the heading the row sits under. */
export function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/**
 * Long paths lose their front, not their back. Truncated the usual way, every
 * change folder in the suite reads `openspec/changes/files-review-surf…` — the
 * same twenty characters, with the part that tells them apart cut off.
 */
export function shortDirectory(directory: string, budget = 34): string {
  if (directory.length <= budget) return directory

  return `…${directory.slice(directory.length - budget + 1)}`
}
