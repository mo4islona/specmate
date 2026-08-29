import { z } from 'zod'
import type { SpecConvention, SpecConventionProfile } from './spec-conventions.ts'

/**
 * Where a task's own artifacts stand. `repository` is the OpenSpec change folder,
 * which an OpenSpec repository keeps as its own content; `internal` is SpecMate's
 * working record, which the repository never carries (REQ-1707).
 */
export const SPEC_LAYOUTS = ['repository', 'internal'] as const
export const SpecLayout = z.enum(SPEC_LAYOUTS)
export type SpecLayout = z.infer<typeof SpecLayout>

/**
 * What a role that writes or judges a specification is given as the convention to
 * follow: the house standard, the sentence the owner wrote about their own suite, or
 * nothing, because there is no suite to be consistent with.
 */
export const SPEC_STANDARDS = ['house', 'described', 'none'] as const
export type SpecStandard = (typeof SPEC_STANDARDS)[number]

/**
 * How a repository's specification convention is carried out. Every question a caller
 * has about a profile is answered here — where the change folder stands, whether the
 * repository keeps what is written there, whether the pipeline specifies at all, what
 * governs the specification it writes — so that a profile is read in one place rather
 * than tested at each call site (REQ-1707/AC-1725).
 *
 * The layout is the one field that does not follow the profile at read time: it is
 * pinned when a task is first provisioned, because the profile is re-read at every
 * node (REQ-1706) and an answer that changes mid-task must not move artifacts that are
 * already written.
 */
export interface SpecImplementation {
  readonly profile: SpecConventionProfile
  readonly layout: SpecLayout
  /** Whether what the task writes in its change folder is the repository's content. */
  readonly keptByRepository: boolean
  /** Whether the specification segment runs (REQ-1706). */
  readonly specifies: boolean
  /** The living specification a change grounds in; null where there is none. */
  readonly suitePath: string | null
  /** The suite's own convention, where the owner described one (REQ-1704/AC-1713). */
  readonly conventionNote: string | null
  readonly standard: SpecStandard
}

/** The layout a profile writes under, for a task that has not pinned one yet. */
export function layoutFor(profile: SpecConventionProfile): SpecLayout {
  return profile === 'openspec' ? 'repository' : 'internal'
}

/**
 * The implementation a task runs under. The layout is the task's pinned one where it
 * has one; a task provisioned before anything was pinned kept its folder in the
 * repository, which is what an absent value reads as.
 */
export function specImplementation(
  convention: SpecConvention | null | undefined,
  layout?: SpecLayout | null,
): SpecImplementation | null {
  if (!convention) return null

  const resolved = layout ?? layoutFor(convention.profile)

  return {
    profile: convention.profile,
    layout: resolved,
    keptByRepository: resolved === 'repository',
    specifies: convention.profile !== 'none',
    suitePath: convention.suitePath,
    conventionNote: convention.conventionNote,
    standard: standardFor(convention.profile),
  }
}

function standardFor(profile: SpecConventionProfile): SpecStandard {
  if (profile === 'openspec') return 'house'

  return profile === 'custom' ? 'described' : 'none'
}
