import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readSpecConventionTree, suitePathWithin } from '../src/spec-conventions.ts'

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'specmate-conventions-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('readSpecConventionTree', () => {
  it('a tree holding living specs answers as an OpenSpec repository', async () => {
    await mkdir(join(root, 'openspec/specs/task-lifecycle'), { recursive: true })

    const tree = await readSpecConventionTree(root, null)

    expect(tree.hasOpenspecSuite).toBe(true)
  })

  // The change folder is scaffolded into every repository SpecMate touches, so
  // keying detection on `openspec/` would make every repository OpenSpec after one task.
  it('a tree holding only a scaffolded change folder does not', async () => {
    await mkdir(join(root, 'openspec/changes/some-task'), { recursive: true })

    const tree = await readSpecConventionTree(root, null)

    expect(tree.hasOpenspecSuite).toBe(false)
  })

  it('an empty tree answers no to both readings', async () => {
    const tree = await readSpecConventionTree(root, null)

    expect(tree).toEqual({ hasOpenspecSuite: false, hasConfiguredSuite: null })
  })

  it('a configured suite that is present is found', async () => {
    await mkdir(join(root, 'docs/spec'), { recursive: true })

    const tree = await readSpecConventionTree(root, 'docs/spec')

    expect(tree.hasConfiguredSuite).toBe(true)
  })

  it('a configured suite that is absent is reported absent, not thrown', async () => {
    const tree = await readSpecConventionTree(root, 'docs/spec')

    expect(tree.hasConfiguredSuite).toBe(false)
  })

  it('a configured path naming a file rather than a directory is absent', async () => {
    await mkdir(join(root, 'docs'), { recursive: true })
    await Bun.write(join(root, 'docs/spec'), 'not a suite')

    const tree = await readSpecConventionTree(root, 'docs/spec')

    expect(tree.hasConfiguredSuite).toBe(false)
  })

  it('the OpenSpec path as the configured one is answered by the OpenSpec reading', async () => {
    await mkdir(join(root, 'openspec/specs'), { recursive: true })

    const tree = await readSpecConventionTree(root, 'openspec/specs')

    expect(tree).toEqual({ hasOpenspecSuite: true, hasConfiguredSuite: null })
  })
})

describe('suitePathWithin', () => {
  it('keeps a path inside the working tree', () => {
    expect(suitePathWithin('/w', 'docs/spec')).toBe('/w/docs/spec')
  })

  it('refuses a path climbing out of the working tree', () => {
    expect(suitePathWithin('/w', '../elsewhere')).toBeNull()
    expect(suitePathWithin('/w', 'docs/../../elsewhere')).toBeNull()
  })

  it('refuses an absolute path', () => {
    expect(suitePathWithin('/w', '/etc')).toBeNull()
  })

  it('refuses the working tree itself', () => {
    expect(suitePathWithin('/w', '.')).toBeNull()
  })
})
