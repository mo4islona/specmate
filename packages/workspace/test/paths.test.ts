import { describe, expect, test } from 'bun:test'
import {
  artifactKindForPath,
  changeDir,
  changeLayoutOf,
  mirrorKey,
  taskBranch,
} from '../src/index.ts'

describe('mirror keys', () => {
  test('are filesystem-safe and stable', () => {
    const key = mirrorKey('https://github.com/example/repo.git')
    expect(key).toMatch(/^[a-z0-9._-]+$/)
    expect(mirrorKey('https://github.com/example/repo.git')).toBe(key)
  })

  test('separate remotes that spell the same repository', () => {
    const https = mirrorKey('https://github.com/example/repo')
    const ssh = mirrorKey('git@github.com:example/repo.git')
    expect(https).not.toBe(ssh)
    expect(https.startsWith('github.com-example-repo-')).toBe(true)
    expect(ssh.startsWith('github.com-example-repo-')).toBe(true)
  })

  test('separate different repositories', () => {
    expect(mirrorKey('https://github.com/example/a')).not.toBe(
      mirrorKey('https://github.com/example/b'),
    )
  })
})

describe('task paths', () => {
  test('branch and change folder derive from the slug', () => {
    expect(taskBranch('fix-reorg')).toBe('task/fix-reorg')
    expect(changeDir('repository', 'fix-reorg')).toBe('openspec/changes/fix-reorg')
  })

  test('the folder stands under the layout the task is pinned to — AC-1722', () => {
    expect(changeDir('internal', 'fix-reorg')).toBe('.specmate/changes/fix-reorg')
    expect(changeLayoutOf('.specmate/changes/fix-reorg')).toBe('internal')
    expect(changeLayoutOf('openspec/changes/fix-reorg')).toBe('repository')
  })
})

describe('artifact kinds', () => {
  test('map the catalog', () => {
    expect(artifactKindForPath('proposal.md')).toBe('proposal')
    expect(artifactKindForPath('design.md')).toBe('design')
    expect(artifactKindForPath('tasks.md')).toBe('tasks')
    expect(artifactKindForPath('specs/workspace-lifecycle/spec.md')).toBe('spec')
    expect(artifactKindForPath('review.md')).toBe('review')
    expect(artifactKindForPath('review/round-2.md')).toBe('review')
    expect(artifactKindForPath('verification.md')).toBe('verification')
    expect(artifactKindForPath('summary.md')).toBe('summary')
    expect(artifactKindForPath('decisions.md')).toBe('decision_log')
  })

  test('leave everything else unmapped', () => {
    expect(artifactKindForPath('.openspec.yaml')).toBeNull()
    expect(artifactKindForPath('notes.txt')).toBeNull()
    expect(artifactKindForPath('diagram.png')).toBeNull()
    expect(artifactKindForPath('scratch/thoughts.md')).toBeNull()
  })
})
