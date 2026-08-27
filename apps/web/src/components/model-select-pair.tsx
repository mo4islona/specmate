import { MODELS, type ModelId, REASONING_EFFORTS, type ReasoningEffort } from '@specmate/core'
import { shortModel } from '../lib/task-pipeline.ts'
import { Select, SelectOption } from '../ui/index.ts'

interface ModelSelectPairProps {
  role: string
  modelValue: ModelId | ''
  reasoningEffortValue: ReasoningEffort | ''
  onModelChange: (value: ModelId | '') => void
  onReasoningEffortChange: (value: ReasoningEffort | '') => void
  disabled?: boolean
  /** Renders a leading "Use default" option, for a field-level override rather than a required setting. */
  includeUseDefault?: boolean
}

/**
 * The per-role model + reasoning-effort pair shared by the Settings screen and
 * the task-creation override form.
 *
 * The two are not the same size and are no longer given the same width: a model
 * name needs room and an effort is one short word. Equal halves is what clipped
 * `claude-sonnet-5` down to `claude-sonnet-!`. The names are the ones the rest
 * of the app says out loud — the task screen has never called it
 * `claude-haiku-4-5-20251001` either.
 */
export function ModelSelectPair({
  role,
  modelValue,
  reasoningEffortValue,
  onModelChange,
  onReasoningEffortChange,
  disabled = false,
  includeUseDefault = false,
}: ModelSelectPairProps) {
  const suffix = includeUseDefault ? ' override' : ''

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2 sm:grid-cols-[10.5rem_7rem]">
      <Select
        aria-label={`${role} model${suffix}`}
        mono
        value={modelValue}
        disabled={disabled}
        onValueChange={(value) => onModelChange(value as ModelId | '')}
      >
        {includeUseDefault && <SelectOption value="">Use default</SelectOption>}
        {MODELS.map((model) => (
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
