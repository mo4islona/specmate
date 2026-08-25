import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readDiffView, readPass, storeDiffView, writePass } from './review-store.ts'

const TIP = 'aaaa'
const NEXT_TIP = 'bbbb'

beforeEach(() => localStorage.clear())
afterEach(() => localStorage.clear())

describe('readPass', () => {
  it('starts empty for a task nobody has read', () => {
    expect(readPass('task-1', TIP)).toEqual({ paths: new Set(), moved: false })
  })

  it('carries marks back to the comparison they were left on', () => {
    writePass('task-1', TIP, new Set(['a.ts', 'b.ts']))

    expect(readPass('task-1', TIP)).toEqual({ paths: new Set(['a.ts', 'b.ts']), moved: false })
  })

  it('drops marks left on an older comparison, and says so', () => {
    writePass('task-1', TIP, new Set(['a.ts']))

    expect(readPass('task-1', NEXT_TIP)).toEqual({ paths: new Set(), moved: true })
  })

  it('says nothing about a moved comparison nobody had marked anything on', () => {
    writePass('task-1', TIP, new Set())

    expect(readPass('task-1', NEXT_TIP)).toEqual({ paths: new Set(), moved: false })
  })

  it('keeps one task out of another task"s pass', () => {
    writePass('task-1', TIP, new Set(['a.ts']))

    expect(readPass('task-2', TIP).paths.size).toBe(0)
  })

  it('starts empty rather than throwing on a record it cannot read', () => {
    localStorage.setItem('specmate.files-viewed.task-1', 'not json')

    expect(readPass('task-1', TIP)).toEqual({ paths: new Set(), moved: false })
  })

  it('survives storage being denied', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })

    expect(readPass('task-1', TIP)).toEqual({ paths: new Set(), moved: false })
  })
})

describe('the reader"s unified/split choice', () => {
  it('defaults to one column', () => {
    expect(readDiffView()).toBe('unified')
  })

  it('holds a choice of two', () => {
    storeDiffView('split')

    expect(readDiffView()).toBe('split')
  })

  it('falls back to one column when storage is denied', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })

    expect(readDiffView()).toBe('unified')
  })
})
