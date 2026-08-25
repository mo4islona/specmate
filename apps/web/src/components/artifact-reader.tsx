import { useQuery } from '@tanstack/react-query'
import { getArtifact } from '../lib/api-client.ts'
import { formatTimestamp } from '../lib/format.ts'
import { queryKeys } from '../lib/query-keys.ts'
import { Button, ErrorNote, Panel, Skeleton, SkeletonText, Waiting } from '../ui/index.ts'
import { ArtifactMarkdown } from './artifact-markdown.tsx'

interface ArtifactReaderProps {
  readonly taskId: string
  readonly artifactId: string
  readonly onClose: () => void
}

/**
 * The task's own documents, read where the task is. Opening one on its own
 * screen costs the owner the pipeline, the spend, and the thread they were
 * reading — everything that says which task this document belongs to.
 */
export function ArtifactReader({ taskId, artifactId, onClose }: ArtifactReaderProps) {
  const artifact = useQuery({
    queryKey: queryKeys.artifact(taskId, artifactId),
    queryFn: ({ signal }) => getArtifact(taskId, artifactId, signal),
  })

  return (
    <Panel flush className="flex min-h-0 flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-3 bg-elevated/55 px-3.5 py-2">
        {artifact.data ? (
          <p className="min-w-0 flex-1 truncate font-mono text-[0.7rem] text-muted">
            {artifact.data.artifact.path}
          </p>
        ) : (
          <Skeleton className="h-2.5 w-48 max-w-full flex-1" />
        )}
        {artifact.data && (
          <span className="hidden shrink-0 font-mono text-[0.6rem] text-muted sm:inline">
            {formatTimestamp(artifact.data.artifact.updatedAt)}
          </span>
        )}
        <Button variant="ghost" className="shrink-0" onClick={onClose}>
          ← thread
        </Button>
      </header>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        {artifact.isPending && (
          <Waiting label="Loading document…" className="space-y-7">
            <SkeletonText lines={4} />
            <SkeletonText lines={5} />
          </Waiting>
        )}
        {artifact.isError && <ErrorNote>Artifact unavailable: {artifact.error.message}</ErrorNote>}
        {artifact.data && (
          <article className="artifact-document min-w-0">
            <ArtifactMarkdown content={artifact.data.artifact.content ?? ''} />
          </article>
        )}
      </div>
    </Panel>
  )
}
