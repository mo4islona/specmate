import { describe, expect, it } from 'vitest'
import type { DiffFileSummary } from './api-client.ts'
import { fileName, groupByDirectory, shortDirectory } from './diff-tree.ts'

function file(path: string): DiffFileSummary {
  return { path, status: 'modified', group: 'code', additions: 1, deletions: 0 }
}

const shape = (files: string[]) =>
  groupByDirectory(files.map(file)).map((group) => [
    group.directory,
    group.files.map((found) => found.path),
  ])

describe('groupByDirectory', () => {
  it('puts the files of one directory under it', () => {
    expect(shape(['src/one.ts', 'src/two.ts'])).toEqual([['src', ['src/one.ts', 'src/two.ts']]])
  })

  it('never nests: a deeper directory is its own heading, not a rung', () => {
    // The shape that read as a ladder — `spec.md` two levels below the change
    // folder's own files, and drawn above them.
    expect(
      shape(['openspec/changes/x/proposal.md', 'openspec/changes/x/specs/ui/spec.md']),
    ).toEqual([
      ['openspec/changes/x', ['openspec/changes/x/proposal.md']],
      ['openspec/changes/x/specs/ui', ['openspec/changes/x/specs/ui/spec.md']],
    ])
  })

  it('leads with the files at the repository root, which have no heading', () => {
    expect(shape(['src/deep.ts', 'README.md'])).toEqual([
      ['', ['README.md']],
      ['src', ['src/deep.ts']],
    ])
  })

  it('sorts the directories, and the files inside each', () => {
    expect(shape(['z/b.ts', 'z/a.ts', 'a/c.ts'])).toEqual([
      ['a', ['a/c.ts']],
      ['z', ['z/a.ts', 'z/b.ts']],
    ])
  })
})

describe('fileName', () => {
  it('is the last segment', () => {
    expect(fileName('openspec/changes/x/proposal.md')).toBe('proposal.md')
  })

  it('is the whole thing at the root', () => {
    expect(fileName('README.md')).toBe('README.md')
  })
})

describe('shortDirectory', () => {
  it('leaves a path that fits alone', () => {
    expect(shortDirectory('src/components')).toBe('src/components')
  })

  it('cuts the front, since the back is what tells two paths apart', () => {
    const short = shortDirectory('openspec/changes/files-review-surface/specs/operator-ui', 24)

    expect(short).toHaveLength(24)
    expect(short.startsWith('…')).toBe(true)
    expect(short.endsWith('specs/operator-ui')).toBe(true)
  })
})
