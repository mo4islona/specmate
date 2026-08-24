import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { listRepositories, setDefaultRepository } from '../lib/api-client.ts'
import { queryKeys } from '../lib/query-keys.ts'
import { Button, Field, Input, Note, Section } from '../ui/index.ts'
import { RequestError } from './request-error.tsx'

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
    <Section
      eyebrow="Launch defaults"
      title="Default repository"
      description="Where a task goes when its request names no repository. A request that names one — by URL or by name — always wins over this."
    >
      <RequestError error={repositories.error} fallback="Could not load the repositories" />
      <RequestError error={save.error} fallback="Could not save" />

      {nothingHasRun && !repositories.isPending && (
        <Note>
          Nothing has run yet, so there is no history to pick from — name a repository and the first
          launch goes there.
        </Note>
      )}

      <form className="flex flex-wrap items-end gap-3" onSubmit={submit}>
        <Field label="Repository URL" id="default-repository" className="min-w-64 flex-1">
          <Input
            type="url"
            list="known-repositories"
            mono
            placeholder="https://github.com/org/repository"
            value={value}
            onChange={(event) => setDraft(event.currentTarget.value)}
          />
        </Field>
        <datalist id="known-repositories">
          {known.map((repository) => (
            <option key={repository.id} value={repository.repoUrl} />
          ))}
        </datalist>

        <Button variant="primary" type="submit" pending={save.isPending} pendingLabel="Saving…">
          Save
        </Button>
        <Button disabled={save.isPending || !current} onClick={() => save.mutate(null)}>
          Clear
        </Button>
      </form>
    </Section>
  )
}
