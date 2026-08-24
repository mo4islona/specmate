import { MODELS, type ModelId, REASONING_EFFORTS, type ReasoningEffort } from '@specmate/core'
import { shortModel } from '../lib/task-pipeline.ts'

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
            {shortModel(model)}
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
