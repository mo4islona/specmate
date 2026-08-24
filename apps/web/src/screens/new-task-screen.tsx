import type { AgentRole, ModelBinding, ModelId, ReasoningEffort } from '@specmate/core'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { useLocation } from 'wouter'
import { ModelSelectPair } from '../components/model-select-pair.tsx'
import { RoleBindings } from '../components/role-bindings.tsx'
import { type SizeChoice, SizePicker } from '../components/size-picker.tsx'
import { ApiRequestError, type CreateTaskInput, createTask } from '../lib/api-client.ts'
import { queryKeys } from '../lib/query-keys.ts'
import { repoLabel } from '../lib/repo-link.ts'
import {
  Button,
  buttonClass,
  Console,
  ConsoleField,
  ErrorNote,
  Field,
  FieldLabel,
  Input,
  Note,
  PageHeader,
  Subpanel,
} from '../ui/index.ts'

/** What the screen holds. Everything but the request is optional at intake (REQ-903). */
export interface NewTaskForm {
  description: string
  repoUrl: string
  baseBranch: string
  planSize: SizeChoice
  modelBindings: CreateTaskInput['modelBindings']
}

const INITIAL_FORM: NewTaskForm = {
  description: '',
  repoUrl: '',
  baseBranch: '',
  planSize: 'auto',
  modelBindings: {},
}

/**
 * REQ-1001: the request is the ask, trimmed at the edges only — everything
 * between is the owner's exact words, blank lines included. An untouched
 * control must reach intake as absent, not as an empty string or a `{}`:
 * intake resolves the repository, and planning names the work.
 */
export function buildCreateTaskPayload(form: NewTaskForm): CreateTaskInput {
  const modelBindings = form.modelBindings ?? {}
  const hasOverride = Object.keys(modelBindings).length > 0

  return {
    description: form.description.trim(),
    repoUrl: form.repoUrl.trim() || undefined,
    baseBranch: form.baseBranch.trim() || undefined,
    planSize: form.planSize === 'auto' ? undefined : form.planSize,
    modelBindings: hasOverride ? modelBindings : undefined,
  }
}

/** Setting a field to `undefined` ("Use default") drops it; an empty role object drops the role too. */
export function setOverrideField<K extends keyof ModelBinding>(
  modelBindings: CreateTaskInput['modelBindings'],
  role: AgentRole,
  field: K,
  value: ModelBinding[K] | undefined,
): CreateTaskInput['modelBindings'] {
  const nextRole = { ...modelBindings?.[role], [field]: value }

  if (nextRole[field] === undefined) delete nextRole[field]

  const next = { ...modelBindings }
  if (Object.keys(nextRole).length > 0) {
    next[role] = nextRole
  } else {
    delete next[role]
  }

  return next
}

interface RepositoryChoiceProps {
  candidates: readonly string[]
  selected: string
  detail?: string
  onSelect: (repoUrl: string) => void
}

/**
 * Shown only when intake could not resolve the repository itself (AC-972).
 * The candidates are what it would have accepted; the field is for anything
 * else, including a repository nothing has run against yet.
 */
export function RepositoryChoice({
  candidates,
  selected,
  detail,
  onSelect,
}: RepositoryChoiceProps) {
  return (
    <Subpanel className="bg-danger/10">
      <FieldLabel>Which repository?</FieldLabel>
      <Note size="xs" className="mt-1">
        {detail ?? 'The request did not name one, and there is no default set.'}
      </Note>

      {candidates.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {candidates.map((repoUrl) => (
            <Button
              key={repoUrl}
              variant={repoUrl === selected ? 'primary' : 'secondary'}
              aria-pressed={repoUrl === selected}
              onClick={() => onSelect(repoUrl)}
            >
              {repoLabel(repoUrl)}
            </Button>
          ))}
        </div>
      )}

      <Input
        id="repo-url"
        type="url"
        mono
        className="mt-3"
        placeholder="https://github.com/org/repository"
        aria-label="Repository URL"
        value={selected}
        onChange={(event) => onSelect(event.currentTarget.value)}
      />
    </Subpanel>
  )
}

export function NewTaskScreen() {
  const [, navigate] = useLocation()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<NewTaskForm>(INITIAL_FORM)
  const request = useRef<HTMLTextAreaElement | null>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: the text is the trigger, not an input — the field is measured *because* what is in it changed.
  useEffect(() => {
    const node = request.current
    if (!node) return

    node.style.height = 'auto'
    node.style.height = `${node.scrollHeight}px`
  }, [form.description])

  const launch = useMutation({
    mutationFn: createTask,
    onSuccess: async ({ task }) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks })
      await queryClient.invalidateQueries({ queryKey: queryKeys.attention })
      navigate(`/tasks/${task.id}`)
    },
  })
  const rejection = launch.error instanceof ApiRequestError ? launch.error : undefined
  const fields = rejection?.fields ?? {}
  const repositoryAsked = Boolean(fields.repoUrl)

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    launch.mutate(buildCreateTaskPayload(form))
  }

  function fieldError(name: keyof CreateTaskInput): string | undefined {
    return fields[name]?.join(' ')
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Launch work"
        description="Say what you want done. The repository comes out of the request; planning names the task once it has read the code."
      />

      {/* The same block the task's console is: this app has one input, and
          launching is the first time the owner uses it. */}
      <Console onSubmit={submit} noValidate>
        <div className="px-4 pt-4">
          <ConsoleField
            id="task-description"
            ref={request}
            rows={3}
            // The screen exists for this one field.
            autoFocus
            className="text-[0.95rem]"
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.currentTarget.value })}
            placeholder="Fix the login redirect in specmate — it lands on the homepage instead of the dashboard."
            aria-label="Request"
            aria-invalid={Boolean(fieldError('description'))}
            aria-describedby={fieldError('description') ? 'task-description-error' : undefined}
          />
          {fieldError('description') && (
            <ErrorNote id="task-description-error">{fieldError('description')}</ErrorNote>
          )}
        </div>

        {repositoryAsked && (
          <div className="px-4 pt-4">
            <RepositoryChoice
              candidates={rejection?.candidates ?? []}
              selected={form.repoUrl}
              detail={fieldError('repoUrl')}
              onSelect={(repoUrl) => setForm({ ...form, repoUrl })}
            />
          </div>
        )}

        {launch.isError && !rejection && (
          <ErrorNote className="px-4 pt-3">{launch.error.message}</ErrorNote>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pb-4 pt-4">
          <SizePicker
            value={form.planSize}
            onChange={(planSize) => setForm({ ...form, planSize })}
          />

          <span className="flex-1" />

          <Button
            variant="primary"
            className="shrink-0"
            type="submit"
            pending={launch.isPending}
            pendingLabel="Launching…"
          >
            Launch task
          </Button>
        </div>
      </Console>

      <details className="group">
        <summary className={`${buttonClass('ghost')} w-fit cursor-pointer list-none`}>
          <span className="transition-transform group-open:rotate-90" aria-hidden="true">
            ›
          </span>
          Advanced
        </summary>

        <div className="mt-4 space-y-6">
          <Field
            label="Base branch"
            id="base-branch"
            hint="Empty means the repository's default branch."
            error={fieldError('baseBranch')}
          >
            <Input
              mono
              placeholder="main"
              value={form.baseBranch}
              onChange={(event) => setForm({ ...form, baseBranch: event.currentTarget.value })}
            />
          </Field>

          <div>
            <FieldLabel>Override models for this task</FieldLabel>
            {fieldError('modelBindings') && (
              <ErrorNote className="mt-2">{fieldError('modelBindings')}</ErrorNote>
            )}
            <div className="mt-4">
              <RoleBindings>
                {(role) => (
                  <ModelSelectPair
                    role={role}
                    includeUseDefault
                    modelValue={form.modelBindings?.[role]?.model ?? ''}
                    reasoningEffortValue={form.modelBindings?.[role]?.reasoningEffort ?? ''}
                    onModelChange={(value) =>
                      setForm({
                        ...form,
                        modelBindings: setOverrideField(
                          form.modelBindings,
                          role,
                          'model',
                          (value || undefined) as ModelId | undefined,
                        ),
                      })
                    }
                    onReasoningEffortChange={(value) =>
                      setForm({
                        ...form,
                        modelBindings: setOverrideField(
                          form.modelBindings,
                          role,
                          'reasoningEffort',
                          (value || undefined) as ReasoningEffort | undefined,
                        ),
                      })
                    }
                  />
                )}
              </RoleBindings>
            </div>
          </div>
        </div>
      </details>
    </div>
  )
}
