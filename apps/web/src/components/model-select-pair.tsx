import { MODELS, type ModelId, REASONING_EFFORTS, type ReasoningEffort } from '@specmate/core'

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

/** The per-role model + reasoning-effort dropdown pair shared by the Settings screen and the task-creation override form. */
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
    <div className="mt-2 grid grid-cols-2 gap-2">
      <select
        aria-label={`${role} model${suffix}`}
        className="control w-full font-mono"
        value={modelValue}
        disabled={disabled}
        onChange={(event) => onModelChange(event.currentTarget.value as ModelId | '')}
      >
        {includeUseDefault && <option value="">Use default</option>}
        {MODELS.map((model) => (
          <option key={model} value={model}>
            {model}
          </option>
        ))}
      </select>
      <select
        aria-label={`${role} reasoning effort${suffix}`}
        className="control w-full font-mono"
        value={reasoningEffortValue}
        disabled={disabled}
        onChange={(event) =>
          onReasoningEffortChange(event.currentTarget.value as ReasoningEffort | '')
        }
      >
        {includeUseDefault && <option value="">Use default</option>}
        {REASONING_EFFORTS.map((effort) => (
          <option key={effort} value={effort}>
            {effort}
          </option>
        ))}
      </select>
    </div>
  )
}
