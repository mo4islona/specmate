import { z } from 'zod'
import { specImplementation } from './spec-implementation.ts'

/**
 * Where a repository's living specification is and which convention governs it. What
 * follows from it — whether the pipeline specifies, where the change folder stands,
 * what the repository keeps — is `SpecImplementation`, one object per profile.
 */
export const SPEC_CONVENTION_PROFILES = ['openspec', 'custom', 'none'] as const
export const SpecConventionProfile = z.enum(SPEC_CONVENTION_PROFILES)
export type SpecConventionProfile = z.infer<typeof SpecConventionProfile>

/**
 * Where an OpenSpec repository keeps its living specifications. Detection keys on
 * this rather than on `openspec/`, because SpecMate's own change folder creates
 * `openspec/changes/` in any repository it touches — keying one level up would make
 * every repository detect as OpenSpec after its first task.
 */
export const OPENSPEC_SUITE_PATH = 'openspec/specs'

/** What the owner chose for a repository, overriding what provisioning detects. */
export const SpecConventionSetting = z.object({
  profile: SpecConventionProfile,
  /** Required by `custom`, where nothing detects the suite; carried by no other profile. */
  suitePath: z.string().min(1).optional(),
  /** A sentence or two on what the suite's convention is. `custom` only. */
  conventionNote: z.string().min(1).optional(),
})
export type SpecConventionSetting = z.infer<typeof SpecConventionSetting>

/** Normalised remote (see `normalizeRemote`) to what the owner chose for it. */
export const SpecConventionSettings = z.record(z.string(), SpecConventionSetting)
export type SpecConventionSettings = z.infer<typeof SpecConventionSettings>

/** The one answer a task runs under, resolved where the tree and the setting are both visible. */
export const SpecConvention = z.object({
  profile: SpecConventionProfile,
  /** The suite's location in the tree; null under `none`. */
  suitePath: z.string().nullable(),
  conventionNote: z.string().nullable(),
  /**
   * A suite the owner configured that the tree does not hold. The task runs as
   * though the repository had no specification, and this is what keeps that from
   * being silent (AC-1702).
   */
  missingSuitePath: z.string().nullable(),
})
export type SpecConvention = z.infer<typeof SpecConvention>

/** What the checked-out tree answers about itself. Gathered by the caller; core does no I/O. */
export interface SpecConventionTree {
  /** The tree holds an OpenSpec root — living specs, not merely a change folder. */
  readonly hasOpenspecSuite: boolean
  /**
   * Whether the path the owner configured is present. Null where the setting names
   * none to look for, which is every profile but `custom`.
   */
  readonly hasConfiguredSuite: boolean | null
}

const NO_SUITE: SpecConvention = {
  profile: 'none',
  suitePath: null,
  conventionNote: null,
  missingSuitePath: null,
}

/**
 * Whether the repository has somewhere to keep a specification — the fact the
 * specification segment is conditional on (REQ-1706). Null before provisioning has
 * resolved the convention: a fact nobody can assemble yet, which the engine reads as
 * "run the node" rather than as "no suite".
 *
 * The rule itself belongs to the profile's implementation, which is where every other
 * consequence of a profile is stated; this is the reading that tolerates not knowing.
 */
export function specSuiteInForce(convention: SpecConvention | null | undefined): boolean | null {
  return specImplementation(convention)?.specifies ?? null
}

/** Which path a setting expects to find, or null where it expects none. */
export function expectedSuitePath(setting: SpecConventionSetting | undefined): string | null {
  if (!setting) return null

  if (setting.profile === 'openspec') return OPENSPEC_SUITE_PATH

  if (setting.profile === 'custom') return setting.suitePath ?? null

  return null
}

/**
 * REQ-1702: detection is what the tree says, and the owner's setting overrides it.
 * A configured suite that is not there resolves to `none` carrying the path it
 * looked for, rather than to a profile pointing the planner at nothing.
 */
export function resolveSpecConvention(
  tree: SpecConventionTree,
  setting: SpecConventionSetting | undefined,
): SpecConvention {
  if (!setting) {
    return tree.hasOpenspecSuite
      ? { ...NO_SUITE, profile: 'openspec', suitePath: OPENSPEC_SUITE_PATH }
      : NO_SUITE
  }

  if (setting.profile === 'none') return NO_SUITE

  const expected = expectedSuitePath(setting)
  if (expected === null) {
    // `custom` saved without a location. The settings store refuses this on write;
    // a row that predates the check must still resolve to something honest.
    return { ...NO_SUITE, missingSuitePath: null }
  }

  const present = setting.profile === 'openspec' ? tree.hasOpenspecSuite : tree.hasConfiguredSuite
  if (present !== true) {
    return { ...NO_SUITE, missingSuitePath: expected }
  }

  return {
    profile: setting.profile,
    suitePath: expected,
    conventionNote: setting.conventionNote ?? null,
    missingSuitePath: null,
  }
}
