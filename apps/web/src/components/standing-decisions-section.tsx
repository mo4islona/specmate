import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'wouter'
import {
  ApiRequestError,
  listStandingDecisions,
  revokeStandingDecision,
  type StandingDecision,
} from '../lib/api-client.ts'
import { formatTimestamp } from '../lib/format.ts'
import { queryKeys } from '../lib/query-keys.ts'

const LABELS: Record<string, string> = {
  'harness-coverage': 'Coverage gap accepted for this repository',
}

function label(decision: StandingDecision): string {
  return LABELS[decision.key] ?? decision.key
}

/**
 * REQ-918: what the system remembers across tasks, and the owner's way to take
 * it back. A repository-wide acceptance belongs here rather than on a task
 * screen, where revoking it would silently change every other task against the
 * same repository.
 */
export function StandingDecisionsSection() {
  const queryClient = useQueryClient()
  const standing = useQuery({
    queryKey: queryKeys.standingDecisions,
    queryFn: ({ signal }) => listStandingDecisions(signal),
  })
  const revoke = useMutation({
    mutationFn: (id: string) => revokeStandingDecision(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.standingDecisions }),
  })

  return (
    <section className="panel space-y-5 p-5 sm:p-7">
      <div>
        <p className="micro-label text-cyan">Remembered across tasks</p>
        <h2 className="mt-2 text-lg font-semibold">Accepted for a repository</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          A later task in the same repository inherits these instead of asking again. Revoking one
          makes the next task ask.
        </p>
      </div>

      {standing.isError && (
        <p className="field-error">
          {standing.error instanceof ApiRequestError
            ? standing.error.message
            : 'Could not load what is remembered'}
        </p>
      )}
      {revoke.isError && (
        <p className="field-error">
          {revoke.error instanceof ApiRequestError ? revoke.error.message : 'Revoke failed'}
        </p>
      )}

      {standing.data?.decisions.length === 0 && (
        <p className="text-sm text-muted">Nothing is remembered across tasks.</p>
      )}

      <ul className="space-y-3">
        {standing.data?.decisions.map((decision) => (
          <li
            key={decision.id}
            className="flex flex-wrap items-start justify-between gap-3 border border-border p-3"
          >
            <div className="min-w-0">
              <p className="text-sm">{label(decision)}</p>
              <p className="mt-1 break-all font-mono text-xs text-muted">{decision.repoUrl}</p>
              <p className="mt-1 text-xs text-muted">
                {decision.originTaskId ? (
                  <>
                    Accepted on{' '}
                    <Link
                      href={`/tasks/${decision.originTaskId}`}
                      className="text-cyan underline-offset-4 hover:underline"
                    >
                      {decision.originTitle ?? decision.originTaskId.slice(0, 8)}
                    </Link>
                  </>
                ) : (
                  'Accepted on a task that no longer exists'
                )}{' '}
                · {formatTimestamp(decision.createdAt)}
              </p>
            </div>
            <button
              type="button"
              className="button-secondary"
              disabled={revoke.isPending && revoke.variables === decision.id}
              onClick={() => revoke.mutate(decision.id)}
            >
              {revoke.isPending && revoke.variables === decision.id ? 'Revoking…' : 'Revoke'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
