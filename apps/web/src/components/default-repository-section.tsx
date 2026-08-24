import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { ApiRequestError, listRepositories, setDefaultRepository } from '../lib/api-client.ts'
import { queryKeys } from '../lib/query-keys.ts'

/**
 * REQ-922: where a launch that names no repository ends up. The list is the
 * repositories tasks have run against, but the field takes any of them — a
 * fresh install has no history to pick from and still has to point somewhere.
 */
export function DefaultRepositorySection() {
  const queryClient = useQueryClient()
  const repositories = useQuery({
    queryKey: queryKeys.repositories,
    queryFn: ({ signal }) => listRepositories(signal),
  })
  const save = useMutation({
    mutationFn: (repoUrl: string | null) => setDefaultRepository(repoUrl),
    onSuccess: async () => {
      setDraft(null)
      await queryClient.invalidateQueries({ queryKey: queryKeys.repositories })
    },
  })

  // Null means "showing what is stored"; a string means the owner is editing.
  const [draft, setDraft] = useState<string | null>(null)

  const known = repositories.data?.repositories ?? []
  const current = known.find((repository) => repository.isDefault)?.repoUrl ?? ''
  const value = draft ?? current
  const nothingHasRun = known.length === 0

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    save.mutate(value.trim() || null)
  }

  return (
    <section className="panel space-y-5">
      <div>
        <p className="micro-label text-info">Launch defaults</p>
        <h2 className="mt-2 text-lg font-semibold">Default repository</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          Where a task goes when its request names no repository. A request that names one — by URL
          or by name — always wins over this.
        </p>
      </div>

      {repositories.isError && (
        <p className="field-error">
          {repositories.error instanceof ApiRequestError
            ? repositories.error.message
            : 'Could not load the repositories'}
        </p>
      )}
      {save.isError && (
        <p className="field-error">
          {save.error instanceof ApiRequestError ? save.error.message : 'Could not save'}
        </p>
      )}

      {nothingHasRun && !repositories.isPending && (
        <p className="text-sm text-muted">
          Nothing has run yet, so there is no history to pick from — name a repository and the first
          launch goes there.
        </p>
      )}

      <form className="flex flex-wrap items-end gap-3" onSubmit={submit}>
        <div className="min-w-64 flex-1">
          <label className="field-label" htmlFor="default-repository">
            Repository URL
          </label>
          <input
            id="default-repository"
            type="url"
            list="known-repositories"
            className="control mt-2 w-full font-mono"
            placeholder="https://github.com/org/repository"
            value={value}
            onChange={(event) => setDraft(event.currentTarget.value)}
          />
          <datalist id="known-repositories">
            {known.map((repository) => (
              <option key={repository.id} value={repository.repoUrl} />
            ))}
          </datalist>
        </div>

        <button className="button-primary" type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
        <button
          className="button-secondary"
          type="button"
          disabled={save.isPending || !current}
          onClick={() => save.mutate(null)}
        >
          Clear
        </button>
      </form>
    </section>
  )
}
