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
    <div className="subpanel bg-danger/10">
      <p className="field-label">Which repository?</p>
      <p className="mt-1 text-xs text-muted">
        {detail ?? 'The request did not name one, and there is no default set.'}
      </p>

      {candidates.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {candidates.map((repoUrl) => (
            <button
              key={repoUrl}
              type="button"
              aria-pressed={repoUrl === selected}
              className={repoUrl === selected ? 'button-primary' : 'button-secondary'}
              onClick={() => onSelect(repoUrl)}
            >
              {repoLabel(repoUrl)}
            </button>
          ))}
        </div>
      )}

      <input
        id="repo-url"
        type="url"
        className="control mt-3 w-full font-mono"
        placeholder="https://github.com/org/repository"
        aria-label="Repository URL"
        value={selected}
        onChange={(event) => onSelect(event.currentTarget.value)}
      />
    </div>
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
      <header>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Launch work</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          Say what you want done. The repository comes out of the request; planning names the task
          once it has read the code.
        </p>
      </header>

      {/* The same block the task's console is: this app has one input, and
          launching is the first time the owner uses it. */}
      <form className="console" onSubmit={submit} noValidate>
        <div className="px-4 pt-4">
          <textarea
            id="task-description"
            ref={request}
            rows={3}
            // biome-ignore lint/a11y/noAutofocus: the screen exists for this one field
            autoFocus
            className="console-field text-[0.95rem]"
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.currentTarget.value })}
            placeholder="Fix the login redirect in specmate — it lands on the homepage instead of the dashboard."
            aria-label="Request"
            aria-invalid={Boolean(fieldError('description'))}
            aria-describedby={fieldError('description') ? 'task-description-error' : undefined}
          />
          {fieldError('description') && (
            <p id="task-description-error" className="field-error">
              {fieldError('description')}
            </p>
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
          <p className="field-error px-4 pt-3">{launch.error.message}</p>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pb-4 pt-4">
          <SizePicker
            value={form.planSize}
            onChange={(planSize) => setForm({ ...form, planSize })}
          />

          <span className="flex-1" />

          <button className="button-primary shrink-0" type="submit" disabled={launch.isPending}>
            {launch.isPending ? 'Launching…' : 'Launch task'}
          </button>
        </div>
      </form>

      <details className="group">
        <summary className="button-ghost w-fit cursor-pointer list-none">
          <span className="transition-transform group-open:rotate-90" aria-hidden="true">
            ›
          </span>
          Advanced
        </summary>

        <div className="mt-4 space-y-6">
          <div>
            <label className="field-label" htmlFor="base-branch">
              Base branch
            </label>
            <p className="mt-1 text-xs text-muted">Empty means the repository's default branch.</p>
            <input
              id="base-branch"
              className="control mt-2 w-full font-mono"
              placeholder="main"
              value={form.baseBranch}
              onChange={(event) => setForm({ ...form, baseBranch: event.currentTarget.value })}
              aria-invalid={Boolean(fieldError('baseBranch'))}
            />
            {fieldError('baseBranch') && <p className="field-error">{fieldError('baseBranch')}</p>}
          </div>

          <div>
            <p className="field-label">Override models for this task</p>
            {fieldError('modelBindings') && (
              <p className="field-error mt-2">{fieldError('modelBindings')}</p>
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
