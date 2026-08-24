import {
  type AgentRole,
  DEFAULT_MODEL_BINDINGS,
  type ModelId,
  type ReasoningEffort,
} from '@specmate/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CoverageWaiversSection } from '../components/coverage-waivers-section.tsx'
import { DefaultRepositorySection } from '../components/default-repository-section.tsx'
import { ModelSelectPair } from '../components/model-select-pair.tsx'
import { RequestError } from '../components/request-error.tsx'
import { RoleBindings } from '../components/role-bindings.tsx'
import { SpecConventionsSection } from '../components/spec-conventions-section.tsx'
import { ThemeSection } from '../components/theme-section.tsx'
import { getModelDefaults, updateModelDefaults } from '../lib/api-client.ts'
import { queryKeys } from '../lib/query-keys.ts'
import { Button, ErrorState, LoadingState, PageHeader, Section } from '../ui/index.ts'

interface SaveVars {
  role: AgentRole
  model?: ModelId
  reasoningEffort?: ReasoningEffort
}

/**
 * Its own component so its loading and error states stay its own. Revoking a
 * coverage waiver is the only way an acceptance ends short of a probe
 * reclassifying the repository, and the prompt on every inheriting task points
 * here — it must not disappear because an unrelated query is slow.
 */
function ModelDefaultsSection() {
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
    return <LoadingState title="Loading model defaults…" />
  }
  if (defaults.isError) {
    return <ErrorState title="Model defaults unavailable" detail={defaults.error.message} />
  }

  const savingRole = save.isPending ? save.variables?.role : undefined
  const failedRole = save.isError ? save.variables?.role : undefined

  return (
    <Section
      title="Model and effort per role"
      description="Every change saves as you make it."
      actions={
        <Button pending={reset.isPending} pendingLabel="Resetting…" onClick={() => reset.mutate()}>
          Reset to defaults
        </Button>
      }
    >
      <RequestError error={reset.error} fallback="Reset failed" />

      <RoleBindings>
        {(role) => {
          const binding = defaults.data.modelDefaults[role]

          return (
            <>
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
                <p className="mt-1 font-mono text-[0.62rem] text-muted">Saving…</p>
              )}
              {failedRole === role && <RequestError error={save.error} fallback="Save failed" />}
            </>
          )
        }}
      </RoleBindings>
    </Section>
  )
}

export function SettingsScreen() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Settings"
        description="Applies to tasks created after a save; a task already running keeps the model and reasoning effort it started with."
      />

      <ModelDefaultsSection />

      <DefaultRepositorySection />

      <CoverageWaiversSection />

      <SpecConventionsSection />

      <ThemeSection />
    </div>
  )
}
