import {
  type ModelId,
  modelsFor,
  type ProviderId,
  providerForModel,
  REASONING_EFFORTS,
  type ReasoningEffort,
} from '@specmate/core'
import { shortModel } from '../lib/task-pipeline.ts'
import { AGENT_LABELS, AgentAvatar, Select, SelectGroup, SelectOption } from '../ui/index.ts'

interface ModelSelectPairProps {
  role: string
  /** Providers this deployment runs — the only ones a binding may name (REQ-1014). */
  providers: readonly ProviderId[]
  modelValue: ModelId
  reasoningEffortValue: ReasoningEffort
  onModelChange: (value: ModelId) => void
  onReasoningEffortChange: (value: ReasoningEffort) => void
  disabled?: boolean
  /** Which of the two is being written, if either. */
  pending?: 'model' | 'reasoningEffort'
  /** For a field-level override rather than a required setting. */
  suffix?: string
}

/**
 * The per-role model + reasoning-effort row shared by the Settings screen and
 * the task-creation override form.
 *
 * There is no provider control, because there was never a provider to choose:
 * a model belongs to exactly one provider (`providerForModel`), so naming both
 * was one fact asked for twice — and the only way to state a pair the API
 * rejects (REQ-112). The provider is the heading its models sit under, wearing
 * the vendor's own mark, and the trigger carries that mark beside the model.
 *
 * Both controls always name a real model and a real effort, never the phrase
 * "Use default": a task resolves its bindings when it is created, so the value
 * an override would inherit is knowable now, and showing it is what lets the
 * owner see what the task will run before deciding to change it. What the form
 * *stores* is the caller's business — see the new-task screen, where a pick
 * equal to the default is no override at all.
 */
export function ModelSelectPair({
  role,
  providers,
  modelValue,
  reasoningEffortValue,
  onModelChange,
  onReasoningEffortChange,
  disabled = false,
  pending,
  suffix = '',
}: ModelSelectPairProps) {
  const chosen = providerForModel(modelValue)

  // A binding written while another provider was configured still has to show
  // what it says; refusing the save is the API's job (REQ-1014), and a trigger
  // gone blank explains none of it.
  const listed = chosen && !providers.includes(chosen) ? [chosen, ...providers] : providers
  const groups = listed
    .map((provider) => ({ provider, models: modelsFor(provider) }))
    .filter((group) => group.models.length > 0)

  const display = (
    <span className="flex min-w-0 items-center gap-2">
      {chosen && <AgentAvatar name={chosen} lit label={AGENT_LABELS[chosen]} />}
      <span className="truncate">{shortModel(modelValue)}</span>
    </span>
  )

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2 sm:grid-cols-[13rem_7rem]">
      <Select
        aria-label={`${role} model${suffix}`}
        mono
        display={display}
        value={modelValue}
        disabled={disabled}
        pending={pending === 'model'}
        onValueChange={(value) => onModelChange(value as ModelId)}
      >
        {groups.map((group) => (
          <SelectGroup
            key={group.provider}
            label={AGENT_LABELS[group.provider]}
            mark={<AgentAvatar name={group.provider} lit />}
          >
            {group.models.map((model) => (
              <SelectOption key={model} value={model}>
                {shortModel(model)}
              </SelectOption>
            ))}
          </SelectGroup>
        ))}
      </Select>
      <Select
        aria-label={`${role} reasoning effort${suffix}`}
        mono
        value={reasoningEffortValue}
        disabled={disabled}
        pending={pending === 'reasoningEffort'}
        onValueChange={(value) => onReasoningEffortChange(value as ReasoningEffort)}
      >
        {REASONING_EFFORTS.map((effort) => (
          <SelectOption key={effort} value={effort}>
            {effort}
          </SelectOption>
        ))}
      </Select>
    </div>
  )
}
