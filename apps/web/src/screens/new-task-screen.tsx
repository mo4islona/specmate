import {
  AGENT_ROLES,
  type AgentRole,
  type ModelBinding,
  type ModelId,
  type ReasoningEffort,
} from '@specmate/core'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { useLocation } from 'wouter'
import { ModelSelectPair } from '../components/model-select-pair.tsx'
import { ApiRequestError, type CreateTaskInput, createTask } from '../lib/api-client.ts'
import { queryKeys } from '../lib/query-keys.ts'
import { repoLabel } from '../lib/repo-link.ts'

/** What the screen holds. Everything but the request is optional at intake (REQ-903). */
export interface NewTaskForm {
  description: string
  repoUrl: string
  baseBranch: string
  modelBindings: CreateTaskInput['modelBindings']
}

const INITIAL_FORM: NewTaskForm = {
  description: '',
  repoUrl: '',
  baseBranch: '',
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
    <div className="border border-danger/35 bg-danger/10 p-4">
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
    <div className="mx-auto max-w-3xl space-y-7">
      <header className="border-b border-border pb-6">
        <p className="micro-label text-phosphor">Task intake</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Launch work</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          Say what you want done. The repository comes out of the request; planning names the task
          once it has read the code.
        </p>
      </header>

      <form className="panel space-y-6 p-5 sm:p-7" onSubmit={submit} noValidate>
        <div>
          <label className="field-label" htmlFor="task-description">
            Request
          </label>
          <textarea
            id="task-description"
            // biome-ignore lint/a11y/noAutofocus: the screen exists for this one field
            autoFocus
            className="control mt-2 min-h-40 w-full resize-y"
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.currentTarget.value })}
            placeholder="Fix the login redirect in specmate — it lands on the homepage instead of the dashboard."
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
          <RepositoryChoice
            candidates={rejection?.candidates ?? []}
            selected={form.repoUrl}
            detail={fieldError('repoUrl')}
            onSelect={(repoUrl) => setForm({ ...form, repoUrl })}
          />
        )}

        <details className="border-t border-border pt-5">
          <summary className="cursor-pointer font-mono text-xs uppercase tracking-widest text-muted">
            Advanced
          </summary>

          <div className="mt-4">
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

          <p className="field-label mt-5">Override models for this task</p>
          {fieldError('modelBindings') && (
            <p className="field-error mt-2">{fieldError('modelBindings')}</p>
          )}
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {AGENT_ROLES.map((role) => (
              <div key={role} className="border border-border p-3">
                <p className="field-label">{role}</p>
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
              </div>
            ))}
          </div>
        </details>

        {launch.isError && !rejection && (
          <p className="border border-danger/35 bg-danger/10 p-3 text-sm text-danger">
            {launch.error.message}
          </p>
        )}

        <div className="flex justify-end border-t border-border pt-5">
          <button className="button-primary" type="submit" disabled={launch.isPending}>
            {launch.isPending ? 'Launching…' : 'Launch task'}
          </button>
        </div>
      </form>
    </div>
  )
}
