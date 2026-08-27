import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { listRepositories, revokeCoverageWaiver } from '../lib/api-client.ts'
import { formatTimestamp } from '../lib/format.ts'
import { queryKeys } from '../lib/query-keys.ts'
import { Button, InlineLink, ListRow, Note, Section, SkeletonFacts, Waiting } from '../ui/index.ts'
import { RequestError } from './request-error.tsx'

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
    <Section
      eyebrow="Remembered across tasks"
      title="Coverage waivers"
      description="Repositories accepted as under-covered. A later task against one of them proceeds without asking again; revoking makes the next task ask."
    >
      <RequestError error={repositories.error} fallback="Could not load the repositories" />
      <RequestError error={revoke.error} fallback="Revoke failed" />

      {repositories.isPending && (
        <Waiting label="Loading repositories…">
          <SkeletonFacts rows={2} />
        </Waiting>
      )}

      {waived?.length === 0 && <Note>No repository has an accepted coverage gap.</Note>}

      <ul className="space-y-3">
        {waived?.map((repository) => {
          const waiver = repository.coverageWaiver
          const revoking = revoke.isPending && revoke.variables === repository.id

          return (
            <ListRow
              key={repository.id}
              primary={
                <p className="break-all font-mono text-xs text-muted-foreground">{repository.repoUrl}</p>
              }
              secondary={
                <Note size="xs" className="mt-1">
                  {waiver?.originTaskId ? (
                    <>
                      Accepted on{' '}
                      <InlineLink href={`/tasks/${waiver.originTaskId}`}>
                        {waiver.originTitle ?? waiver.originTaskId.slice(0, 8)}
                      </InlineLink>
                    </>
                  ) : (
                    'Accepted on a task that no longer exists'
                  )}{' '}
                  · {formatTimestamp(waiver?.acceptedAt ?? '')}
                </Note>
              }
              action={
                <Button
                  pending={revoking}
                  pendingLabel="Revoking…"
                  onClick={() => revoke.mutate(repository.id)}
                >
                  Revoke
                </Button>
              }
            />
          )
        })}
      </ul>
    </Section>
  )
}
