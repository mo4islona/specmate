import { z } from 'zod'
import { TASK_TYPES } from './pipeline.ts'

/**
 * What planning declares about the work once it has read the repository: what
 * it is called, how much process it needs, and what has to land before it. The
 * engine bounds this; it no longer decides it (REQ-1306).
 */
export const PLAN_SIZES = ['small', 'medium', 'large'] as const
export const PlanSize = z.enum(PLAN_SIZES)
export type PlanSize = z.infer<typeof PlanSize>

/**
 * A task the planner judges must land before this one. It is a proposal: only
 * the owner's choice at the kickoff gate turns it into a task.
 */
export const PlanPrerequisite = z.object({
  /** Stable, kebab-case, unique within one plan — the identity the decision prompt names. */
  key: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'prerequisite key must be kebab-case'),
  title: z.string().min(1).max(120),
  why_md: z.string().min(1),
})
export type PlanPrerequisite = z.infer<typeof PlanPrerequisite>

export const PlanShape = z.object({
  /**
   * Intake derives a title from the request before anyone has opened the
   * repository; this is the one that replaces it (REQ-1306). The task's slug
   * is not re-derived from it — the branch and change folder already exist.
   */
  title: z.string().min(1).max(120),
  type: z.enum(TASK_TYPES),
  size: PlanSize,
  prerequisites: z.array(PlanPrerequisite).default([]),
})
export type PlanShape = z.infer<typeof PlanShape>

/** Two entries under one key are a defective plan, not two tasks. */
export function duplicatePrerequisiteKeys(plan: PlanShape): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const prerequisite of plan.prerequisites) {
    if (seen.has(prerequisite.key)) duplicates.add(prerequisite.key)
    seen.add(prerequisite.key)
  }

  return [...duplicates]
}
