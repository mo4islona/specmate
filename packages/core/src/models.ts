import { z } from 'zod'
import { AGENT_ROLES, AgentRole } from './roles.ts'

export const MODELS = [
  'claude-opus-5',
  'claude-sonnet-5',
  'claude-haiku-4-5-20251001',
  'claude-fable-5',
] as const

export const ModelId = z.enum(MODELS)
export type ModelId = z.infer<typeof ModelId>

/** The Claude Code CLI's own `--effort` values (`claude --help`) — not a SpecMate invention. */
export const REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

export const ReasoningEffort = z.enum(REASONING_EFFORTS)
export type ReasoningEffort = z.infer<typeof ReasoningEffort>

export const ModelBinding = z.object({
  model: ModelId,
  reasoningEffort: ReasoningEffort,
})
export type ModelBinding = z.infer<typeof ModelBinding>

export const ModelBindings = z.record(AgentRole, ModelBinding)
export type ModelBindings = z.infer<typeof ModelBindings>

/** A per-role, per-field partial override — task creation overrides and settings updates share this shape. */
export const ModelBindingsOverride = z.partialRecord(AgentRole, ModelBinding.partial())
export type ModelBindingsOverride = z.infer<typeof ModelBindingsOverride>

/**
 * The one factory default: the migration seed, the fallback for a role somehow
 * missing from the settings row, and the Settings screen's reset target.
 * `model` matches today's pre-Settings `DEFAULT_RUNNER_CONFIG.model`; `high` is
 * a starting point for effort, tunable per role from Settings once the owner
 * has a sense of where it matters.
 */
export const DEFAULT_MODEL_BINDINGS: ModelBindings = Object.fromEntries(
  AGENT_ROLES.map((role) => [role, { model: 'claude-opus-5', reasoningEffort: 'high' }]),
) as ModelBindings

/**
 * Fills every role, resolving `model` and `reasoningEffort` independently per
 * field — override wins, else the passed-in defaults, else
 * `DEFAULT_MODEL_BINDINGS` — used identically by task creation and migration
 * backfill. A field-only override for a role inherits the other field from
 * that role's current default rather than from the factory default.
 */
export function resolveModelBindings(
  defaults: ModelBindingsOverride,
  override?: ModelBindingsOverride,
): ModelBindings {
  const resolved = {} as Record<AgentRole, ModelBinding>
  for (const role of AGENT_ROLES) {
    const fallback = DEFAULT_MODEL_BINDINGS[role]
    resolved[role] = {
      model: override?.[role]?.model ?? defaults[role]?.model ?? fallback.model,
      reasoningEffort:
        override?.[role]?.reasoningEffort ??
        defaults[role]?.reasoningEffort ??
        fallback.reasoningEffort,
    }
  }

  return resolved
}
