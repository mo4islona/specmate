import { z } from 'zod'

/** Task lifecycle from §5. Transitions are orchestrator-owned; agents never set state. */
export const TASK_STATES = [
  'draft',
  'planning',
  'kickoff_brief',
  'human_kickoff_gate',
  'research',
  'spec_review',
  'human_spec_gate',
  'implement',
  'verify',
  'code_review',
  'summarize',
  'human_final_gate',
  'publish',
  'archived',
  'waiting_human',
  'paused',
  'blocked',
  'cancelled',
  'failed',
] as const

export const TaskState = z.enum(TASK_STATES)
export type TaskState = z.infer<typeof TaskState>

export const HUMAN_GATES = ['human_kickoff_gate', 'human_spec_gate', 'human_final_gate'] as const
export type HumanGate = (typeof HUMAN_GATES)[number]

export const TERMINAL_STATES = ['archived', 'cancelled', 'failed'] as const

// Legal transitions are derived from a task's pinned pipeline — see
// `canTransition` and `graphTransitions` in pipeline.ts. The hand-written
// table this module used to hold survives only as the expected rendering of
// the feature definition in the pipeline tests.

export function isTerminal(state: TaskState): boolean {
  return (TERMINAL_STATES as readonly TaskState[]).includes(state)
}

export function isHumanGate(state: TaskState): state is HumanGate {
  return (HUMAN_GATES as readonly TaskState[]).includes(state)
}

/** Loop caps (§5). Defaults are per-task overridable config, not constants in code paths. */
export const DEFAULT_CAPS = {
  max_spec_iterations: 3,
  max_impl_iterations: 3,
  max_kickoff_regenerations: 2,
  /** Same finding id twice in a row → escalate instead of looping. */
  repeated_finding_threshold: 2,
  /**
   * How deep a chain of tasks a plan may build. 1 means a task the owner
   * launched may split; a task a split created may not. This is what closes
   * the harness recursion — the option is never offered at the cap, so no
   * prompt has to be trusted with it (REQ-617).
   */
  max_plan_depth: 1,
  /** How many tasks one plan may create. Proposals past this are named to the owner, not dropped in silence. */
  max_prerequisite_tasks: 2,
  /**
   * How many non-blocking questions one stage result may turn into cards. The
   * policy used to live only in the planner's prompt (REQ-1208); this is the
   * floor under it. Blocking requests are never capped — each one is the
   * reason a task parked.
   */
  max_questions_per_stage: 3,
} as const

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

export const DEFAULT_BUDGETS = {
  max_wall_clock_minutes: 180,
  max_cost_usd: 20,
} as const

export const Budgets = z.object({
  max_wall_clock_minutes: z
    .number()
    .int()
    .positive()
    .default(DEFAULT_BUDGETS.max_wall_clock_minutes),
  max_cost_usd: z.number().positive().default(DEFAULT_BUDGETS.max_cost_usd),
})
export type Budgets = z.infer<typeof Budgets>
