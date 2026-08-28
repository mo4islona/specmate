import {
  type AgentRole,
  DEFAULT_MODEL_BINDINGS,
  type ModelId,
  type ProviderId,
  providerForModel,
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
  provider?: ProviderId
  model?: ModelId
  reasoningEffort?: ReasoningEffort
}

/** Which control the save in flight came from, so only that one shows it. */
function writtenField(saving: SaveVars): 'model' | 'reasoningEffort' | undefined {
  if (saving.model !== undefined) return 'model'
  if (saving.reasoningEffort !== undefined) return 'reasoningEffort'

  return undefined
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
    return <LoadingState title="Loading model defaults…" shape="rows" />
  }
  if (defaults.isError) {
    return <ErrorState title="Model defaults unavailable" detail={defaults.error.message} />
  }

  const saving = save.isPending ? save.variables : undefined
  const failedRole = save.isError ? save.variables?.role : undefined

  return (
    <Section
      title="Provider, model and effort per role"
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
                providers={defaults.data.availableProviders}
                modelValue={binding.model}
                reasoningEffortValue={binding.reasoningEffort}
                pending={saving?.role === role ? writtenField(saving) : undefined}
                // The provider goes with the model rather than being inferred
                // downstream: the row then stores what the owner was shown
                // (AC-137, AC-1809).
                onModelChange={(value) =>
                  save.mutate({ role, model: value, provider: providerForModel(value) })
                }
                onReasoningEffortChange={(value) => save.mutate({ role, reasoningEffort: value })}
              />
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
