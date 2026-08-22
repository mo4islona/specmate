import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'wouter'
import { ApiRequestError, listRepositories, revokeCoverageWaiver } from '../lib/api-client.ts'
import { formatTimestamp } from '../lib/format.ts'
import { queryKeys } from '../lib/query-keys.ts'

/**
 * REQ-918: the repositories the owner has accepted as under-covered, and the
 * way to take one back. A repository-wide acceptance belongs here rather than
 * on a task screen, where revoking it would silently change every other task
 * against the same repository.
 */
export function CoverageWaiversSection() {
  const queryClient = useQueryClient()
  const repositories = useQuery({
    queryKey: queryKeys.repositories,
    queryFn: ({ signal }) => listRepositories(signal),
  })
  const revoke = useMutation({
    mutationFn: (repositoryId: string) => revokeCoverageWaiver(repositoryId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.repositories }),
  })

  const waived = repositories.data?.repositories.filter((repository) => repository.coverageWaiver)

  return (
    <section className="panel space-y-5 p-5 sm:p-7">
      <div>
        <p className="micro-label text-cyan">Remembered across tasks</p>
        <h2 className="mt-2 text-lg font-semibold">Coverage waivers</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          Repositories accepted as under-covered. A later task against one of them proceeds without
          asking again; revoking makes the next task ask.
        </p>
      </div>

      {repositories.isError && (
        <p className="field-error">
          {repositories.error instanceof ApiRequestError
            ? repositories.error.message
            : 'Could not load the repositories'}
        </p>
      )}
      {revoke.isError && (
        <p className="field-error">
          {revoke.error instanceof ApiRequestError ? revoke.error.message : 'Revoke failed'}
        </p>
      )}

      {waived?.length === 0 && (
        <p className="text-sm text-muted">No repository has an accepted coverage gap.</p>
      )}

      <ul className="space-y-3">
        {waived?.map((repository) => (
          <li
            key={repository.id}
            className="flex flex-wrap items-start justify-between gap-3 border border-border p-3"
          >
            <div className="min-w-0">
              <p className="break-all font-mono text-xs text-muted">{repository.repoUrl}</p>
              <p className="mt-1 text-xs text-muted">
                {repository.coverageWaiver?.originTaskId ? (
                  <>
                    Accepted on{' '}
                    <Link
                      href={`/tasks/${repository.coverageWaiver.originTaskId}`}
                      className="text-cyan underline-offset-4 hover:underline"
                    >
                      {repository.coverageWaiver.originTitle ??
                        repository.coverageWaiver.originTaskId.slice(0, 8)}
                    </Link>
                  </>
                ) : (
                  'Accepted on a task that no longer exists'
                )}{' '}
                · {formatTimestamp(repository.coverageWaiver?.acceptedAt ?? '')}
              </p>
            </div>
            <button
              type="button"
              className="button-secondary"
              disabled={revoke.isPending && revoke.variables === repository.id}
              onClick={() => revoke.mutate(repository.id)}
            >
              {revoke.isPending && revoke.variables === repository.id ? 'Revoking…' : 'Revoke'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
