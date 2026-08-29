import { describe, expect, it } from 'vitest'
import { type SpecConvention, specSuiteInForce } from '../src/spec-conventions.ts'
import { layoutFor, specImplementation } from '../src/spec-implementation.ts'

function convention(overrides: Partial<SpecConvention> = {}): SpecConvention {
  return {
    profile: 'none',
    suitePath: null,
    conventionNote: null,
    missingSuitePath: null,
    ...overrides,
  }
}

describe('a profile is carried out one way', () => {
  it('keeps the change folder in the repository only where the repository is OpenSpec — AC-1721', () => {
    expect(layoutFor('openspec')).toBe('repository')
    expect(layoutFor('custom')).toBe('internal')
    expect(layoutFor('none')).toBe('internal')
  })

  it('answers every consequence of a profile from one object — AC-1725', () => {
    const openspec = specImplementation(
      convention({ profile: 'openspec', suitePath: 'openspec/specs' }),
    )

    expect(openspec).toMatchObject({
      layout: 'repository',
      keptByRepository: true,
      specifies: true,
      suitePath: 'openspec/specs',
      standard: 'house',
    })
  })

  it('gives a described suite its own standard and keeps it out of the tree — AC-1723', () => {
    const custom = specImplementation(
      convention({
        profile: 'custom',
        suitePath: 'docs/specs',
        conventionNote: 'one file per area',
      }),
    )

    expect(custom).toMatchObject({
      layout: 'internal',
      keptByRepository: false,
      specifies: true,
      conventionNote: 'one file per area',
      standard: 'described',
    })
  })

  it('reads a repository with no suite as specifying nothing — AC-1722', () => {
    expect(specImplementation(convention())).toMatchObject({
      layout: 'internal',
      keptByRepository: false,
      specifies: false,
      suitePath: null,
      standard: 'none',
    })
  })

  it('takes the layout a task pinned over the one its profile would choose — AC-1724', () => {
    const pinned = specImplementation(convention({ profile: 'openspec' }), 'internal')

    expect(pinned).toMatchObject({ layout: 'internal', keptByRepository: false, specifies: true })
  })

  it('has nothing to say about a convention nobody has resolved', () => {
    expect(specImplementation(null)).toBeNull()
    expect(specSuiteInForce(null)).toBeNull()
    expect(specSuiteInForce(convention({ profile: 'custom' }))).toBe(true)
  })
})
