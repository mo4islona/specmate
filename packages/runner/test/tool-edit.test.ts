import { describe, expect, it } from 'bun:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clampDiff, unifiedDiff } from '../src/edit-diff.ts'
import { editFor, PREVIEW_LINES } from '../src/tool-edit.ts'

async function workspace(files: Record<string, string> = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'tool-edit-'))
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(root, name), content)
  }

  return root
}

function lines(count: number, prefix = 'line'): string {
  return `${Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}`).join('\n')}\n`
}

describe('unified diff', () => {
  it('a replacement in the middle of a file keeps the file line numbers', () => {
    const before = 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n'
    const after = 'a\nb\nc\nd\ne\nCHANGED\ng\nh\ni\nj\n'

    const diff = unifiedDiff(before, after)

    expect(diff.additions).toBe(1)
    expect(diff.deletions).toBe(1)
    expect(diff.text.split('\n')[0]).toBe('@@ -3,7 +3,7 @@')
    expect(diff.text).toContain('-f')
    expect(diff.text).toContain('+CHANGED')
  })

  it('two distant changes become two hunks', () => {
    const before = lines(40)
    const after = before.replace('line 3\n', 'THREE\n').replace('line 35\n', 'THIRTY-FIVE\n')

    const hunks = unifiedDiff(before, after)
      .text.split('\n')
      .filter((line) => line.startsWith('@@'))

    expect(hunks).toHaveLength(2)
  })

  it('a new file is all additions', () => {
    const diff = unifiedDiff('', 'one\ntwo\n')

    expect(diff.additions).toBe(2)
    expect(diff.deletions).toBe(0)
    expect(diff.text.split('\n')[0]).toBe('@@ -0,0 +1,2 @@')
  })

  it('identical texts produce no diff', () => {
    expect(unifiedDiff('same\n', 'same\n')).toEqual({ text: '', additions: 0, deletions: 0 })
  })

  it('a rewrite past the alignment limit reads as one replacement', () => {
    const before = lines(700, 'old')
    const after = lines(700, 'new')

    const diff = unifiedDiff(before, after)

    expect(diff.deletions).toBe(700)
    expect(diff.additions).toBe(700)
  })
})

describe('clamping', () => {
  it('a diff within the budget is untouched', () => {
    expect(clampDiff('@@ -1,1 +1,1 @@\n-a\n+b', 40)).toEqual({
      text: '@@ -1,1 +1,1 @@\n-a\n+b',
      clamped: false,
    })
  })

  it('a diff past the budget is cut and says so', () => {
    const clamped = clampDiff(lines(80).trimEnd(), 40)

    expect(clamped.clamped).toBe(true)
    expect(clamped.text.split('\n')).toHaveLength(40)
  })
})

describe('the edit behind a tool use (AC-237)', () => {
  it('a replacement is diffed against the file it names', async () => {
    const root = await workspace({ 'a.ts': 'one\ntwo\nthree\n' })

    const edit = await editFor(
      {
        tool: 'Edit',
        target: 'a.ts',
        input: { file_path: 'a.ts', old_string: 'two', new_string: 'TWO' },
      },
      root,
    )

    expect(edit?.path).toBe('a.ts')
    expect(edit?.additions).toBe(1)
    expect(edit?.deletions).toBe(1)
    expect(edit?.anchored).toBe(true)
    expect(edit?.preview).toContain('+TWO')
  })

  it('an absolute path is reported relative to the working tree', async () => {
    const root = await workspace({ 'a.ts': 'one\n' })

    const edit = await editFor(
      {
        tool: 'Edit',
        target: join(root, 'a.ts'),
        input: { file_path: join(root, 'a.ts'), old_string: 'one', new_string: 'ONE' },
      },
      root,
    )

    expect(edit?.path).toBe('a.ts')
  })

  it('a path outside the working tree carries no edit', async () => {
    const root = await workspace()

    const edit = await editFor(
      {
        tool: 'Edit',
        target: '/etc/hosts',
        input: { file_path: '/etc/hosts', old_string: 'a', new_string: 'b' },
      },
      root,
    )

    expect(edit).toBeNull()
  })

  it('a write of a new file is all additions', async () => {
    const root = await workspace()

    const edit = await editFor(
      { tool: 'Write', target: 'new.md', input: { file_path: 'new.md', content: 'one\ntwo\n' } },
      root,
    )

    expect(edit?.additions).toBe(2)
    expect(edit?.deletions).toBe(0)
  })

  it('a write over an existing file diffs against it', async () => {
    const root = await workspace({ 'a.md': 'one\ntwo\n' })

    const edit = await editFor(
      { tool: 'Write', target: 'a.md', input: { file_path: 'a.md', content: 'one\nTWO\n' } },
      root,
    )

    expect(edit?.additions).toBe(1)
    expect(edit?.deletions).toBe(1)
  })

  it('several edits in one use are applied in order', async () => {
    const root = await workspace({ 'a.ts': 'one\ntwo\nthree\n' })

    const edit = await editFor(
      {
        tool: 'MultiEdit',
        target: 'a.ts',
        input: {
          file_path: 'a.ts',
          edits: [
            { old_string: 'one', new_string: 'ONE' },
            { old_string: 'three', new_string: 'THREE' },
          ],
        },
      },
      root,
    )

    expect(edit?.additions).toBe(2)
    expect(edit?.deletions).toBe(2)
    expect(edit?.anchored).toBe(true)
  })

  it('an edit the file already holds is read from the other side', async () => {
    const root = await workspace({ 'a.ts': 'one\nTWO\nthree\n' })

    const edit = await editFor(
      {
        tool: 'Edit',
        target: 'a.ts',
        input: { file_path: 'a.ts', old_string: 'two', new_string: 'TWO' },
      },
      root,
    )

    expect(edit?.anchored).toBe(true)
    expect(edit?.preview).toContain('-two')
    expect(edit?.preview).toContain('+TWO')
  })
})

describe('what cannot be established (AC-238, AC-239)', () => {
  it('a truncated edit still counts the whole edit', async () => {
    const root = await workspace({ 'big.txt': lines(2000, 'old') })

    const edit = await editFor(
      {
        tool: 'Write',
        target: 'big.txt',
        input: { file_path: 'big.txt', content: lines(2000, 'new') },
      },
      root,
    )

    expect(edit?.truncated).toBe(true)
    expect(edit?.additions).toBe(2000)
    expect(edit?.deletions).toBe(2000)
    expect(edit?.preview.split('\n').length).toBeLessThanOrEqual(PREVIEW_LINES)
  })

  it('an edit against a file that is not there is unanchored, not lost', async () => {
    const root = await workspace()

    const edit = await editFor(
      {
        tool: 'Edit',
        target: 'gone.ts',
        input: { file_path: 'gone.ts', old_string: 'a', new_string: 'b' },
      },
      root,
    )

    expect(edit?.anchored).toBe(false)
    expect(edit?.additions).toBe(1)
    expect(edit?.deletions).toBe(1)
  })

  it('a tool use carrying no edit carries no diff', async () => {
    const root = await workspace({ 'a.ts': 'one\n' })

    expect(
      await editFor({ tool: 'Read', target: 'a.ts', input: { file_path: 'a.ts' } }, root),
    ).toBeNull()
    expect(await editFor({ tool: 'Bash', target: 'ls', input: { command: 'ls' } }, root)).toBeNull()
  })

  it('an edit that changes nothing carries no diff', async () => {
    const root = await workspace({ 'a.ts': 'one\n' })

    const edit = await editFor(
      {
        tool: 'Edit',
        target: 'a.ts',
        input: { file_path: 'a.ts', old_string: 'one', new_string: 'one' },
      },
      root,
    )

    expect(edit).toBeNull()
  })
})
