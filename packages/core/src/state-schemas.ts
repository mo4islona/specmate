import { z } from 'zod'
import { DEFAULT_BUDGETS, DEFAULT_CAPS, TASK_STATES } from './state.ts'

/**
 * The lifecycle checked at a boundary, kept apart from the lifecycle itself.
 *
 * `state.ts` is what every surface reads — is this state terminal, is it a gate,
 * what are the caps — and none of those questions need a validator. Left in one
 * file with these, they carried zod into every bundle that asked one, because a
 * `z.object({ … })` full of `.int().positive().default(…)` is a tree of calls no
 * bundler can prove nothing observes. It was a sixth of what the web app shipped
 * to draw an inbox that validates nothing.
 *
 * Both halves leave through the package's own index, so nothing outside had to
 * learn the difference. Split the others the same way if a bundle ever reaches
 * one of them.
 */
export const TaskState = z.enum(TASK_STATES)
export type TaskState = z.infer<typeof TaskState>

export const Caps = z.object({
  max_spec_iterations: z.number().int().positive().default(DEFAULT_CAPS.max_spec_iterations),
  max_impl_iterations: z.number().int().positive().default(DEFAULT_CAPS.max_impl_iterations),
  max_kickoff_regenerations: z
    .number()
    .int()
    .nonnegative()
    .default(DEFAULT_CAPS.max_kickoff_regenerations),
  repeated_finding_threshold: z
    .number()
    .int()
    .positive()
    .default(DEFAULT_CAPS.repeated_finding_threshold),
  max_plan_depth: z.number().int().nonnegative().default(DEFAULT_CAPS.max_plan_depth),
  max_prerequisite_tasks: z
    .number()
    .int()
    .nonnegative()
    .default(DEFAULT_CAPS.max_prerequisite_tasks),
  max_questions_per_stage: z
    .number()
    .int()
    .nonnegative()
    .default(DEFAULT_CAPS.max_questions_per_stage),
})
export type Caps = z.infer<typeof Caps>

export const Budgets = z.object({
  max_wall_clock_minutes: z
    .number()
    .int()
    .positive()
    .default(DEFAULT_BUDGETS.max_wall_clock_minutes),
  max_cost_usd: z.number().positive().default(DEFAULT_BUDGETS.max_cost_usd),
})
export type Budgets = z.infer<typeof Budgets>
