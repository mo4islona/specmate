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

/** Gate nodes plus the parked interrupt state — everything "/attention" should read as waiting on a human. */
export function isAwaitingHuman(state: TaskState): boolean {
  return isHumanGate(state) || state === 'waiting_human'
}

/** Loop caps (§5). Defaults are per-task overridable config, not constants in code paths. */
export const DEFAULT_CAPS = {
  max_spec_iterations: 3,
  max_impl_iterations: 3,
  max_kickoff_regenerations: 2,
  /** Same finding id twice in a row → escalate instead of looping. */
  repeated_finding_threshold: 2,
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
