import { useQuery } from '@tanstack/react-query'
import { Link } from 'wouter'
import { ArtifactMarkdown } from '../components/artifact-markdown.tsx'
import { ErrorState, LoadingState } from '../components/query-state.tsx'
import { type ArtifactSummary, getArtifact, listArtifacts } from '../lib/api-client.ts'
import { formatTimestamp } from '../lib/format.ts'
import { queryKeys } from '../lib/query-keys.ts'

interface ArtifactsScreenProps {
  taskId: string
  artifactId?: string
}

function groupArtifacts(artifacts: ArtifactSummary[]): Map<string, ArtifactSummary[]> {
  const groups = new Map<string, ArtifactSummary[]>()
  for (const artifact of artifacts) {
    const group = groups.get(artifact.kind) ?? []
    group.push(artifact)
    groups.set(artifact.kind, group)
  }

  return groups
}

export function ArtifactsScreen({ taskId, artifactId }: ArtifactsScreenProps) {
  const artifacts = useQuery({
    queryKey: queryKeys.artifacts(taskId),
    queryFn: ({ signal }) => listArtifacts(taskId, signal),
  })
  const artifact = useQuery({
    queryKey: queryKeys.artifact(taskId, artifactId ?? 'none'),
    queryFn: ({ signal }) => getArtifact(taskId, artifactId ?? '', signal),
    enabled: Boolean(artifactId),
  })

  if (artifacts.isPending) {
    return <LoadingState title="Indexing task artifacts…" />
  }
  if (artifacts.isError) {
    return <ErrorState title="Artifact index unavailable" detail={artifacts.error.message} />
  }

  const grouped = groupArtifacts(artifacts.data.artifacts)

  return (
    <div className="space-y-6">
      <header className="flex flex-col justify-between gap-4 border-b border-border pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="micro-label text-cyan">Artifact reader</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Task documents</h1>
          <p className="mt-3 text-sm text-muted">Stored snapshots from the task change folder.</p>
        </div>
        <Link href={`/tasks/${taskId}`} className="button-secondary self-start sm:self-auto">
          ← Task timeline
        </Link>
      </header>

      <div className="grid min-w-0 gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className="panel min-w-0 p-3">
          {[...grouped.entries()].map(([kind, rows]) => (
            <section key={kind} className="mb-5 last:mb-0">
              <h2 className="micro-label px-2 text-muted">{kind}</h2>
              <ul className="mt-2 space-y-1">
                {rows.map((row) => (
                  <li key={row.id}>
                    <Link
                      href={`/tasks/${taskId}/artifacts/${row.id}`}
                      className={`block min-w-0 border-l-2 px-2 py-2 text-sm transition-colors ${
                        artifactId === row.id
                          ? 'border-phosphor bg-phosphor/8 text-text'
                          : 'border-transparent text-muted hover:bg-elevated hover:text-text'
                      }`}
                    >
                      <span className="block truncate">{row.path.split('/').at(-1)}</span>
                      <span className="mt-1 block truncate font-mono text-[0.65rem] text-muted">
                        {row.path}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {artifacts.data.artifacts.length === 0 && (
            <p className="p-3 text-sm text-muted">No artifacts have been indexed.</p>
          )}
        </aside>

        <section className="panel min-w-0 overflow-hidden">
          {!artifactId && (
            <div className="grid min-h-96 place-items-center p-8 text-center text-sm text-muted">
              Select an artifact to read its stored snapshot.
            </div>
          )}
          {artifactId && artifact.isPending && (
            <div className="grid min-h-96 place-items-center p-8 font-mono text-sm text-muted">
              Loading document…
            </div>
          )}
          {artifactId && artifact.isError && (
            <div className="p-5">
              <ErrorState title="Artifact unavailable" detail={artifact.error.message} />
            </div>
          )}
          {artifact.data && (
            <>
              <header className="border-b border-border bg-elevated px-4 py-4 sm:px-6">
                <p className="break-all font-mono text-xs text-cyan">
                  {artifact.data.artifact.path}
                </p>
                <p className="mt-2 font-mono text-[0.65rem] text-muted">
                  snapshot updated {formatTimestamp(artifact.data.artifact.updatedAt)}
                </p>
              </header>
              <article className="artifact-document min-w-0 overflow-x-auto p-5 sm:p-8">
                <ArtifactMarkdown content={artifact.data.artifact.content ?? ''} />
              </article>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
