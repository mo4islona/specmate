import { useQuery } from '@tanstack/react-query'
import { ArtifactMarkdown } from '../components/artifact-markdown.tsx'
import { ListDetailPanel } from '../components/list-detail-panel.tsx'
import { type ArtifactSummary, getArtifact, listArtifacts } from '../lib/api-client.ts'
import { formatTimestamp } from '../lib/format.ts'
import { queryKeys } from '../lib/query-keys.ts'
import { cn, ErrorState, Icon, LoadingState, MicroLabel, NavRow, Note } from '../ui/index.ts'

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
    return <LoadingState title="Indexing task artifacts…" shape="rows" />
  }
  if (artifacts.isError) {
    return <ErrorState title="Artifact index unavailable" detail={artifacts.error.message} />
  }

  const grouped = groupArtifacts(artifacts.data.artifacts)

  return (
    <div className="min-h-0 min-w-0 flex-1">
      <ListDetailPanel
        selectedId={artifactId}
        isPending={artifact.isPending}
        isError={artifact.isError}
        error={artifact.error}
        notSelectedLabel="Select an artifact to read its stored snapshot."
        loadingLabel="Loading document…"
        errorTitle="Artifact unavailable"
        sidebar={
          <>
            {[...grouped.entries()].map(([kind, rows]) => (
              <section key={kind} className="mb-4 last:mb-0">
                <MicroLabel as="h2">{kind.replaceAll('_', ' ')}</MicroLabel>
                <ul className="mt-1.5 space-y-0.5">
                  {rows.map((row) => {
                    const open = artifactId === row.id

                    return (
                      <li key={row.id}>
                        {/* The same row the step's own shelf draws: a page glyph,
                            then the name in the face every path in this app is
                            set in. Two places, one thing, one treatment. */}
                        <NavRow
                          href={`/tasks/${taskId}/docs/${row.id}`}
                          active={open}
                          className="flex min-w-0 items-center gap-2.5"
                        >
                          <Icon
                            name="file"
                            className={open ? 'text-foreground' : 'text-muted-foreground'}
                          />
                          <span className="min-w-0 flex-1">
                            <span
                              className={cn(
                                'block truncate font-mono text-[0.74rem]',
                                open ? 'text-foreground' : 'text-muted-foreground',
                              )}
                            >
                              {row.path.split('/').at(-1)}
                            </span>
                            <span className="mt-0.5 block truncate font-mono text-[0.62rem] text-muted-foreground">
                              {row.path}
                            </span>
                          </span>
                        </NavRow>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
            {artifacts.data.artifacts.length === 0 && <Note>No artifacts have been indexed.</Note>}
          </>
        }
      >
        {artifact.data && (
          <>
            <header className="sticky top-0 z-10 bg-popover px-4 py-3 sm:px-6">
              <p className="break-all font-mono text-xs text-muted-foreground">
                {artifact.data.artifact.path}
              </p>
              <p className="mt-1 font-mono text-[0.62rem] text-muted-foreground">
                snapshot updated {formatTimestamp(artifact.data.artifact.updatedAt)}
              </p>
            </header>
            <article className="artifact-document min-w-0 overflow-x-auto p-4 sm:p-6">
              <ArtifactMarkdown content={artifact.data.artifact.content ?? ''} />
            </article>
          </>
        )}
      </ListDetailPanel>
    </div>
  )
}
