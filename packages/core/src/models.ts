import { z } from 'zod'
import { AGENT_ROLES, AgentRole, ProviderId } from './roles.ts'

export const MODELS = [
  'claude-opus-5',
  'claude-sonnet-5',
  'claude-haiku-4-5-20251001',
  'claude-fable-5',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.5',
  'gpt-5.4',
  'gpt-5.4-mini',
] as const

export const ModelId = z.enum(MODELS)
export type ModelId = z.infer<typeof ModelId>

/**
 * What each provider's CLI will accept, in the order the surfaces offer them;
 * the first is that provider's default. A model belongs to exactly one provider
 * — `claude-opus-5` handed to `codex exec` is a failed run, not a degraded one —
 * so this, not `MODELS`, is what answers whether a binding can run.
 *
 * Copilot is in the provider enum because the database has had it since the
 * first migration and SpecMate ships no models for it; configuring it is
 * refused at startup rather than discovered at the first stage bound to it.
 */
export const PROVIDER_MODELS: Readonly<Record<ProviderId, readonly ModelId[]>> = {
  'claude-code': [
    'claude-opus-5',
    'claude-sonnet-5',
    'claude-haiku-4-5-20251001',
    'claude-fable-5',
  ],
  codex: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini'],
  copilot: [],
}

/** Tolerant of a provider outside the catalog: a stored value is data, not a promise. */
export function modelsFor(provider: ProviderId): readonly ModelId[] {
  return PROVIDER_MODELS[provider] ?? []
}

export function providerOffersModel(provider: ProviderId, model: ModelId | undefined): boolean {
  return model !== undefined && modelsFor(provider).includes(model)
}

/** The model a role falls back to under a provider. Undefined only for a provider with no catalog. */
export function defaultModelFor(provider: ProviderId): ModelId | undefined {
  return modelsFor(provider)[0]
}

/** The provider a model belongs to; every model belongs to exactly one. */
export function providerForModel(model: ModelId | undefined): ProviderId | undefined {
  if (model === undefined) return undefined

  return (Object.keys(PROVIDER_MODELS) as ProviderId[]).find((provider) =>
    providerOffersModel(provider, model),
  )
}

/**
 * The Claude Code CLI's own `--effort` values (`claude --help`), which are also
 * the levels the Codex CLI's shipped models accept — one vocabulary because the
 * two do not differ, not because either was made to fit the other.
 */
export const REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

export const ReasoningEffort = z.enum(REASONING_EFFORTS)
export type ReasoningEffort = z.infer<typeof ReasoningEffort>

export const ModelBinding = z.object({
  provider: ProviderId,
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
 * The provider a fresh install runs, and the one every factory binding names.
 *
 * The shipped default has to be satisfiable by the shipped configuration: the
 * configured provider set defaults to this one alone, and a factory binding
 * naming another would make the Settings screen's reset store a preference the
 * deployment cannot honour. Which provider each role *prefers* stays in the role
 * catalog, where the cross-provider rule reads it.
 */
export const SHIPPED_PROVIDER = 'claude-code' as const satisfies ProviderId

/**
 * The one factory default: the migration seed, the fallback for a role somehow
 * missing from the settings row, and the Settings screen's reset target. `high`
 * is a starting point for effort, tunable per role from Settings once the owner
 * has a sense of where it matters.
 */
export const DEFAULT_MODEL_BINDINGS: ModelBindings = Object.fromEntries(
  AGENT_ROLES.map((role) => {
    const model = defaultModelFor(SHIPPED_PROVIDER)
    if (!model) throw new Error(`${SHIPPED_PROVIDER} has no models`)

    return [role, { provider: SHIPPED_PROVIDER, model, reasoningEffort: 'high' }]
  }),
) as ModelBindings

/**
 * Fills every role — override wins, else the passed-in defaults, else
 * `DEFAULT_MODEL_BINDINGS` — used identically by task creation, the settings
 * update, and reading a row written before bindings carried a provider.
 *
 * The provider is resolved first, because it decides which models are
 * admissible: a role switched to another provider without being given a model
 * takes one of that provider's rather than keeping the old provider's (AC-137).
 * A model named without a provider carries its own provider with it, which is
 * both what a model-only override means and what makes a stored binding written
 * before this field existed read back unchanged (AC-352).
 */
export function resolveModelBindings(
  defaults: ModelBindingsOverride,
  override?: ModelBindingsOverride,
): ModelBindings {
  const resolved = {} as Record<AgentRole, ModelBinding>
  for (const role of AGENT_ROLES) {
    const fallback = DEFAULT_MODEL_BINDINGS[role]
    const chosen = override?.[role]
    const current = defaults[role]

    const provider =
      chosen?.provider ??
      providerForModel(chosen?.model) ??
      current?.provider ??
      providerForModel(current?.model) ??
      fallback.provider

    const inherited = [current?.model, fallback.model].find((model) =>
      providerOffersModel(provider, model),
    )
    const model = chosen?.model ?? inherited ?? defaultModelFor(provider) ?? fallback.model

    resolved[role] = {
      provider,
      model,
      reasoningEffort:
        chosen?.reasoningEffort ?? current?.reasoningEffort ?? fallback.reasoningEffort,
    }
  }

  return resolved
}

/**
 * The model a stage runs, once its provider is decided (REQ-112, AC-138).
 *
 * A checking node's provider is chosen to differ from the one that wrote the
 * artifacts under review, so it routinely is not the provider the binding names
 * — and the binding's model then belongs to somebody else's CLI. The provider
 * that will actually run is what the model has to follow.
 */
export function stageModel(binding: ModelBinding, provider: ProviderId): ModelId {
  if (providerOffersModel(provider, binding.model)) return binding.model

  return defaultModelFor(provider) ?? binding.model
}

/**
 * The binding fields that are wrong together rather than wrong alone, named the
 * way the surfaces report a field. Empty means the override is coherent; it says
 * nothing about whether the provider is one this deployment runs.
 */
export function incoherentBindings(override: ModelBindingsOverride): string[] {
  const offending: string[] = []
  for (const [role, binding] of Object.entries(override)) {
    if (!binding?.provider || !binding.model) continue
    if (providerOffersModel(binding.provider, binding.model)) continue

    offending.push(`${role}.model`)
  }

  return offending
}
