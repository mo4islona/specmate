import {
  AGENT_ROLES,
  type AgentRole,
  DEFAULT_MODEL_BINDINGS,
  type ModelId,
  type ReasoningEffort,
} from '@specmate/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ModelSelectPair } from '../components/model-select-pair.tsx'
import { ErrorState, LoadingState } from '../components/query-state.tsx'
import { RepoPoliciesSection } from '../components/repo-policies-section.tsx'
import { ApiRequestError, getModelDefaults, updateModelDefaults } from '../lib/api-client.ts'
import { queryKeys } from '../lib/query-keys.ts'

interface SaveVars {
  role: AgentRole
  model?: ModelId
  reasoningEffort?: ReasoningEffort
}

export function SettingsScreen() {
  const queryClient = useQueryClient()
  const defaults = useQuery({
    queryKey: queryKeys.modelDefaults,
    queryFn: ({ signal }) => getModelDefaults(signal),
  })
  const save = useMutation({
    mutationFn: ({ role, ...fields }: SaveVars) => updateModelDefaults({ [role]: fields }),
    onSuccess: (response) => {
      queryClient.setQueryData(queryKeys.modelDefaults, response)
    },
  })
  const reset = useMutation({
    mutationFn: () => updateModelDefaults(DEFAULT_MODEL_BINDINGS),
    onSuccess: (response) => {
      queryClient.setQueryData(queryKeys.modelDefaults, response)
    },
  })

  if (defaults.isPending) {
    return <LoadingState title="Loading settings…" />
  }
  if (defaults.isError) {
    return <ErrorState title="Settings unavailable" detail={defaults.error.message} />
  }

  const savingRole = save.isPending ? save.variables?.role : undefined
  const failedRole = save.isError ? save.variables?.role : undefined

  return (
    <div className="mx-auto max-w-3xl space-y-7">
      <header className="border-b border-border pb-6">
        <p className="micro-label text-phosphor">Settings</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Settings</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          Applies to tasks created after a save; a task already running keeps the model and
          reasoning effort it started with.
        </p>
      </header>

      <section className="panel space-y-5 p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="micro-label text-cyan">Model defaults</p>
            <h2 className="mt-2 text-lg font-semibold">Default model and effort per role</h2>
          </div>
          <button
            type="button"
            className="button-secondary"
            disabled={reset.isPending}
            onClick={() => reset.mutate()}
          >
            {reset.isPending ? 'Resetting…' : 'Reset to defaults'}
          </button>
        </div>
        {reset.isError && (
          <p className="field-error">
            {reset.error instanceof ApiRequestError ? reset.error.message : 'Reset failed'}
          </p>
        )}

        <dl className="grid gap-4 sm:grid-cols-2">
          {AGENT_ROLES.map((role) => {
            const binding = defaults.data.modelDefaults[role]

            return (
              <div key={role} className="border border-border p-3">
                <p className="field-label">{role}</p>
                <ModelSelectPair
                  role={role}
                  modelValue={binding.model}
                  reasoningEffortValue={binding.reasoningEffort}
                  disabled={savingRole === role}
                  onModelChange={(value) => value && save.mutate({ role, model: value })}
                  onReasoningEffortChange={(value) =>
                    value && save.mutate({ role, reasoningEffort: value })
                  }
                />
                {savingRole === role && (
                  <p className="mt-1 font-mono text-[0.68rem] text-muted">Saving…</p>
                )}
                {failedRole === role && (
                  <p className="field-error">
                    {save.error instanceof ApiRequestError ? save.error.message : 'Save failed'}
                  </p>
                )}
              </div>
            )
          })}
        </dl>
      </section>

      <RepoPoliciesSection />
    </div>
  )
}
