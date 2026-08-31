import { useQuery } from '@tanstack/react-query'
import { ArtifactMarkdown } from '../components/artifact-markdown.tsx'
import { ListDetailPanel } from '../components/list-detail-panel.tsx'
import { getArtifact, listArtifacts } from '../lib/api-client.ts'
import { formatTimestamp } from '../lib/format.ts'
import { queryKeys } from '../lib/query-keys.ts'
import { type NamedDocument, namedDocuments } from '../lib/task-documents.ts'
import { EmptyState, ErrorState, Icon, LoadingState, NavRow, Panel } from '../ui/index.ts'

interface ArtifactsScreenProps {
  taskId: string
  artifactId?: string
}

export function ArtifactsScreen({ taskId, artifactId }: ArtifactsScreenProps) {
  const artifacts = useQuery({
    queryKey: queryKeys.artifacts(taskId),
    queryFn: ({ signal }) => listArtifacts(taskId, signal),
  })

  if (artifacts.isPending) {
    return <LoadingState title="Indexing task artifacts…" shape="rows" />
  }
  if (artifacts.isError) {
    return <ErrorState title="Artifact index unavailable" detail={artifacts.error.message} />
  }

  if (artifacts.data.artifacts.length === 0) {
    return (
      <Panel as="div" flush>
        <EmptyState>This task has not committed any documents yet.</EmptyState>
      </Panel>
    )
  }

  return (
    <ArtifactsReader
      taskId={taskId}
      artifactId={artifactId}
      documents={namedDocuments(artifacts.data.artifacts)}
    />
  )
}

interface ArtifactsReaderProps {
  readonly taskId: string
  readonly artifactId?: string
  readonly documents: readonly NamedDocument[]
}

/**
 * One rail of documents beside the one being read.
 *
 * The rail used to head each kind with the kind's own name and then draw the
 * file under it — `TASKS` over `tasks.md`, `REVIEW` over `review.md` — with the
 * change folder, the same string on every row, truncated under both. Three
 * lines to say one thing, and the one thing said in a spec convention's words
 * rather than in the pipeline's. So a row is the document's name, the folder is
 * the reader's business only once they open one, and the path that does carry
 * something — which capability a specification is for — carries it alone.
 */
function ArtifactsReader({ taskId, artifactId, documents }: ArtifactsReaderProps) {
  // A pane reading "select an artifact" beside a list of nine is a screen spent
  // on an instruction. The first in reading order is the change's own statement
  // of itself, so it opens; the address changes when the reader picks another.
  const openId = artifactId ?? documents[0]?.artifact.id
  const artifact = useQuery({
    queryKey: queryKeys.artifact(taskId, openId ?? 'none'),
    queryFn: ({ signal }) => getArtifact(taskId, openId ?? '', signal),
    enabled: Boolean(openId),
  })

  const open = documents.find((document) => document.artifact.id === openId)
  const openQualifier = open?.qualifier ?? null

  return (
    <div className="min-h-0 min-w-0 flex-1">
      <ListDetailPanel
        selectedId={openId}
        isPending={artifact.isPending}
        isError={artifact.isError}
        error={artifact.error}
        notSelectedLabel="Select a document to read its stored snapshot."
        loadingLabel="Loading document…"
        errorTitle="Artifact unavailable"
        sidebar={
          <nav aria-label="Task documents" className="min-w-0">
            <ul className="space-y-0.5">
              {documents.map((document) => (
                <li key={document.artifact.id}>
                  <NavRow
                    href={`/tasks/${taskId}/docs/${document.artifact.id}`}
                    active={document.artifact.id === openId}
                    title={document.artifact.path}
                    className="flex min-w-0 items-center gap-2.5"
                  >
                    <Icon name="file" className="shrink-0" />
                    <span className="shrink-0 text-[0.82rem]">{document.name}</span>
                    {/* The gap is a flex rule, which the row's accessible name
                        does not get: without this the reader hears one word. */}{' '}
                    {document.qualifier !== null && (
                      <span className="min-w-0 flex-1 truncate text-right font-mono text-[0.66rem] text-muted-foreground">
                        {document.qualifier}
                      </span>
                    )}
                  </NavRow>
                </li>
              ))}
            </ul>
          </nav>
        }
      >
        {artifact.data && (
          <>
            <header className="sticky top-0 z-10 bg-popover px-4 py-3 sm:px-6">
              <h2 className="font-medium text-foreground text-sm">
                {open?.name ?? 'Document'}
                {openQualifier !== null && (
                  <span className="ml-2 font-mono text-muted-foreground text-xs">
                    {openQualifier}
                  </span>
                )}
              </h2>
              {/* Where it is kept, said once, on the document it belongs to
                  rather than under every row of the rail. */}
              <p className="mt-1 break-all font-mono text-[0.62rem] text-muted-foreground">
                {artifact.data.artifact.path} · snapshot updated{' '}
                {formatTimestamp(artifact.data.artifact.updatedAt)}
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
