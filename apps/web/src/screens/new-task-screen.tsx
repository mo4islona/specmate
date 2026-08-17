import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { useLocation } from 'wouter'
import { ApiRequestError, type CreateTaskInput, createTask } from '../lib/api-client.ts'
import { queryKeys } from '../lib/query-keys.ts'

const INITIAL_FORM: CreateTaskInput = {
  title: '',
  description: '',
  type: 'bugfix',
  repoUrl: '',
  baseBranch: 'main',
}

/**
 * REQ-903: the request is optional, so a blank textarea must reach intake as
 * absent, not as an empty string — trimmed at the edges only, everything
 * between is the owner's exact words, blank lines included.
 */
export function buildCreateTaskPayload(form: CreateTaskInput): CreateTaskInput {
  const description = form.description?.trim()

  return { ...form, description: description || undefined }
}

export function NewTaskScreen() {
  const [, navigate] = useLocation()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<CreateTaskInput>(INITIAL_FORM)
  const launch = useMutation({
    mutationFn: createTask,
    onSuccess: async ({ task }) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks })
      await queryClient.invalidateQueries({ queryKey: queryKeys.attention })
      navigate(`/tasks/${task.id}`)
    },
  })
  const fields = launch.error instanceof ApiRequestError ? launch.error.fields : {}

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
          Pin the repository and base branch. The pipeline owns everything after launch.
        </p>
      </header>

      <form className="panel space-y-6 p-5 sm:p-7" onSubmit={submit} noValidate>
        <div>
          <label className="field-label" htmlFor="task-description">
            Request
          </label>
          <p className="mt-1 text-xs text-muted">
            What you want done, in your own words. The planner works from this.
          </p>
          <textarea
            id="task-description"
            className="control mt-2 min-h-32 w-full resize-y"
            value={form.description ?? ''}
            onChange={(event) => setForm({ ...form, description: event.currentTarget.value })}
            placeholder="Describe the request…"
            aria-invalid={Boolean(fieldError('description'))}
            aria-describedby={fieldError('description') ? 'task-description-error' : undefined}
          />
          {fieldError('description') && (
            <p id="task-description-error" className="field-error">
              {fieldError('description')}
            </p>
          )}
        </div>

        <div>
          <label className="field-label" htmlFor="task-title">
            Title
          </label>
          <input
            id="task-title"
            className="control mt-2 w-full"
            value={form.title}
            onChange={(event) => setForm({ ...form, title: event.currentTarget.value })}
            aria-invalid={Boolean(fieldError('title'))}
            aria-describedby={fieldError('title') ? 'task-title-error' : undefined}
          />
          {fieldError('title') && (
            <p id="task-title-error" className="field-error">
              {fieldError('title')}
            </p>
          )}
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <label className="field-label" htmlFor="task-type">
              Task type
            </label>
            <select
              id="task-type"
              className="control mt-2 w-full"
              value={form.type}
              onChange={(event) =>
                setForm({ ...form, type: event.currentTarget.value as CreateTaskInput['type'] })
              }
              aria-invalid={Boolean(fieldError('type'))}
            >
              <option value="bugfix">Bugfix</option>
              <option value="feature">Feature</option>
            </select>
            {fieldError('type') && <p className="field-error">{fieldError('type')}</p>}
          </div>

          <div>
            <label className="field-label" htmlFor="base-branch">
              Base branch
            </label>
            <input
              id="base-branch"
              className="control mt-2 w-full font-mono"
              value={form.baseBranch}
              onChange={(event) => setForm({ ...form, baseBranch: event.currentTarget.value })}
              aria-invalid={Boolean(fieldError('baseBranch'))}
            />
            {fieldError('baseBranch') && <p className="field-error">{fieldError('baseBranch')}</p>}
          </div>
        </div>

        <div>
          <label className="field-label" htmlFor="repo-url">
            Repository URL
          </label>
          <input
            id="repo-url"
            type="url"
            className="control mt-2 w-full font-mono"
            placeholder="https://github.com/org/repository"
            value={form.repoUrl}
            onChange={(event) => setForm({ ...form, repoUrl: event.currentTarget.value })}
            aria-invalid={Boolean(fieldError('repoUrl'))}
          />
          {fieldError('repoUrl') && <p className="field-error">{fieldError('repoUrl')}</p>}
        </div>

        {launch.isError && !(launch.error instanceof ApiRequestError) && (
          <p className="border border-danger/35 bg-danger/10 p-3 text-sm text-danger">
            {launch.error.message}
          </p>
        )}

        <div className="flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-mono text-xs text-muted">The task starts in draft.</p>
          <button className="button-primary" type="submit" disabled={launch.isPending}>
            {launch.isPending ? 'Launching…' : 'Launch task'}
          </button>
        </div>
      </form>
    </div>
  )
}
