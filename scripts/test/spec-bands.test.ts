import { describe, expect, it } from 'vitest'
import { bandOf, nextFree, parseRegistry } from '../spec-bands.ts'

const REGISTRY = `bandSize: 100
bands:
  persistence: 300
  # A capability that filled 900 and claimed a second block.
  operator-ui: [900, 1900]
`

const registry = parseRegistry(REGISTRY)

describe('the band registry', () => {
  it('reads a capability that holds one block and one that holds two', () => {
    expect(registry.bandSize).toBe(100)
    expect(registry.bands.get('persistence')).toEqual([300])
    expect(registry.bands.get('operator-ui')).toEqual([900, 1900])
  })

  it("orders a capability's blocks oldest first however they are written", () => {
    const scrambled = parseRegistry('bandSize: 100\nbands:\n  a: [1900, 900]\n')

    expect(scrambled.bands.get('a')).toEqual([900, 1900])
  })

  it('ignores a line that names no number', () => {
    expect(parseRegistry('bandSize: 100\nbands:\n  a:\n').bands.has('a')).toBe(false)
  })
})

describe('whether an ID belongs to a capability', () => {
  it.each([
    ['the first number of the older block', 900, 900],
    ['the last number of the older block', 999, 900],
    ['a number in the newer block', 1904, 1900],
  ])('accepts %s', (_name, id, band) => {
    expect(bandOf(registry, 'operator-ui', id)).toBe(band)
  })

  it.each([
    ['a number between the two blocks', 1500],
    ['a number below both', 899],
    ['a number above both', 2000],
  ])('refuses %s', (_name, id) => {
    expect(bandOf(registry, 'operator-ui', id)).toBeUndefined()
  })

  it('refuses a capability the registry does not name', () => {
    expect(bandOf(registry, 'unheard-of', 900)).toBeUndefined()
  })
})

describe('the next free number', () => {
  it('starts at the block when nothing has been used', () => {
    expect(nextFree(registry, 'persistence', new Map())).toBe(300)
  })

  it('is one past the highest used in that block', () => {
    expect(nextFree(registry, 'persistence', new Map([[300, 315]]))).toBe(316)
  })

  it('allocates from the newest block, not the oldest with room', () => {
    // 900 has 992..999 free and 1900 is untouched; the newer block wins, so one
    // change's scenarios never straddle two blocks.
    expect(nextFree(registry, 'operator-ui', new Map([[900, 991]]))).toBe(1900)
  })

  it('keeps counting inside the newest block once it is in use', () => {
    expect(
      nextFree(
        registry,
        'operator-ui',
        new Map([
          [900, 991],
          [1900, 1910],
        ]),
      ),
    ).toBe(1911)
  })

  it('reports a full block rather than spilling past it', () => {
    expect(nextFree(registry, 'operator-ui', new Map([[1900, 1999]]))).toBeNull()
  })

  it('reports nothing for a capability with no block', () => {
    expect(nextFree(registry, 'unheard-of', new Map())).toBeNull()
  })
})
