import {
  type ModelId,
  modelsFor,
  type ProviderId,
  REASONING_EFFORTS,
  type ReasoningEffort,
} from '@specmate/core'
import { shortModel } from '../lib/task-pipeline.ts'
import { Select, SelectOption } from '../ui/index.ts'

interface ModelSelectPairProps {
  role: string
  /** Providers this deployment runs — the only ones a binding may name (REQ-1014). */
  providers: readonly ProviderId[]
  providerValue: ProviderId | ''
  modelValue: ModelId | ''
  reasoningEffortValue: ReasoningEffort | ''
  /**
   * The provider in force where this control names none, so the models offered
   * are still the ones the role will actually run under.
   */
  defaultProvider: ProviderId
  onProviderChange: (value: ProviderId | '') => void
  onModelChange: (value: ModelId | '') => void
  onReasoningEffortChange: (value: ReasoningEffort | '') => void
  disabled?: boolean
  /** Renders a leading "Use default" option, for a field-level override rather than a required setting. */
  includeUseDefault?: boolean
}

/**
 * The per-role provider + model + reasoning-effort row shared by the Settings
 * screen and the task-creation override form.
 *
 * The three are not the same size and are not given the same width: a model
 * name needs room, a provider name a little less, and an effort is one short
 * word. Equal thirds is what clipped `claude-sonnet-5` down to `claude-sonnet-!`.
 * The names are the ones the rest of the app says out loud — the task screen has
 * never called it `claude-haiku-4-5-20251001` either.
 *
 * A model belongs to a provider, so the models offered are that provider's and
 * no others: a pair the API rejects (REQ-112) is one this must never present.
 */
export function ModelSelectPair({
  role,
  providers,
  providerValue,
  modelValue,
  reasoningEffortValue,
  defaultProvider,
  onProviderChange,
  onModelChange,
  onReasoningEffortChange,
  disabled = false,
  includeUseDefault = false,
}: ModelSelectPairProps) {
  const suffix = includeUseDefault ? ' override' : ''
  const models = modelsFor(providerValue || defaultProvider)

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2 sm:grid-cols-[7.5rem_10.5rem_7rem]">
      <Select
        aria-label={`${role} provider${suffix}`}
        mono
        className="col-span-2 sm:col-span-1"
        value={providerValue}
        disabled={disabled}
        onValueChange={(value) => onProviderChange(value as ProviderId | '')}
      >
        {includeUseDefault && <SelectOption value="">Use default</SelectOption>}
        {providers.map((provider) => (
          <SelectOption key={provider} value={provider}>
            {provider}
          </SelectOption>
        ))}
      </Select>
      <Select
        aria-label={`${role} model${suffix}`}
        mono
        value={modelValue}
        disabled={disabled}
        onValueChange={(value) => onModelChange(value as ModelId | '')}
      >
        {includeUseDefault && <SelectOption value="">Use default</SelectOption>}
        {models.map((model) => (
          <SelectOption key={model} value={model}>
            {shortModel(model)}
          </SelectOption>
        ))}
      </Select>
      <Select
        aria-label={`${role} reasoning effort${suffix}`}
        mono
        value={reasoningEffortValue}
        disabled={disabled}
        onValueChange={(value) => onReasoningEffortChange(value as ReasoningEffort | '')}
      >
        {includeUseDefault && <SelectOption value="">Use default</SelectOption>}
        {REASONING_EFFORTS.map((effort) => (
          <SelectOption key={effort} value={effort}>
            {effort}
          </SelectOption>
        ))}
      </Select>
    </div>
  )
}
