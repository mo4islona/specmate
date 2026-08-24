import { describe, expect, it } from 'vitest'
import {
  expectedSuitePath,
  OPENSPEC_SUITE_PATH,
  resolveSpecConvention,
  type SpecConventionSetting,
  type SpecConventionTree,
} from '../src/spec-conventions.ts'

function tree(overrides: Partial<SpecConventionTree> = {}): SpecConventionTree {
  return { hasOpenspecSuite: false, hasConfiguredSuite: null, ...overrides }
}

describe('resolveSpecConvention', () => {
  it('a tree with a living OpenSpec suite detects as openspec', () => {
    const resolved = resolveSpecConvention(tree({ hasOpenspecSuite: true }), undefined)

    expect(resolved).toEqual({
      profile: 'openspec',
      suitePath: OPENSPEC_SUITE_PATH,
      conventionNote: null,
      missingSuitePath: null,
    })
  })

  it('a tree with nothing recognisable detects as none', () => {
    const resolved = resolveSpecConvention(tree(), undefined)

    expect(resolved.profile).toBe('none')
    expect(resolved.suitePath).toBeNull()
    expect(resolved.missingSuitePath).toBeNull()
  })

  it("the owner's setting overrides what the tree would detect", () => {
    const setting: SpecConventionSetting = { profile: 'none' }

    const resolved = resolveSpecConvention(tree({ hasOpenspecSuite: true }), setting)

    expect(resolved.profile).toBe('none')
  })

  it('a configured custom suite carries its path and the note', () => {
    const setting: SpecConventionSetting = {
      profile: 'custom',
      suitePath: 'docs/spec',
      conventionNote: 'Numbered requirements, one file per service.',
    }

    const resolved = resolveSpecConvention(tree({ hasConfiguredSuite: true }), setting)

    expect(resolved).toEqual({
      profile: 'custom',
      suitePath: 'docs/spec',
      conventionNote: 'Numbered requirements, one file per service.',
      missingSuitePath: null,
    })
  })

  // AC-1702: the task proceeds, and the path it looked for survives so the owner is told.
  it('a configured suite that is not in the tree resolves to none and names the path', () => {
    const setting: SpecConventionSetting = { profile: 'custom', suitePath: 'docs/spec' }

    const resolved = resolveSpecConvention(tree({ hasConfiguredSuite: false }), setting)

    expect(resolved.profile).toBe('none')
    expect(resolved.suitePath).toBeNull()
    expect(resolved.missingSuitePath).toBe('docs/spec')
  })

  it('an owner who declared openspec against a tree without one is told, not obeyed', () => {
    const setting: SpecConventionSetting = { profile: 'openspec' }

    const resolved = resolveSpecConvention(tree({ hasOpenspecSuite: false }), setting)

    expect(resolved.profile).toBe('none')
    expect(resolved.missingSuitePath).toBe(OPENSPEC_SUITE_PATH)
  })

  it('a custom setting stored without a location resolves to none', () => {
    const setting = { profile: 'custom' } as SpecConventionSetting

    const resolved = resolveSpecConvention(tree({ hasConfiguredSuite: false }), setting)

    expect(resolved.profile).toBe('none')
    expect(resolved.missingSuitePath).toBeNull()
  })
})

describe('expectedSuitePath', () => {
  it('openspec expects the living-specs directory', () => {
    expect(expectedSuitePath({ profile: 'openspec' })).toBe(OPENSPEC_SUITE_PATH)
  })

  it('custom expects what the owner configured', () => {
    expect(expectedSuitePath({ profile: 'custom', suitePath: 'docs/spec' })).toBe('docs/spec')
  })

  it('none and an absent setting expect nothing', () => {
    expect(expectedSuitePath({ profile: 'none' })).toBeNull()
    expect(expectedSuitePath(undefined)).toBeNull()
  })
})
