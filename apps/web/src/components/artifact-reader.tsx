import { useQuery } from '@tanstack/react-query'
import { getArtifact } from '../lib/api-client.ts'
import { formatTimestamp } from '../lib/format.ts'
import { queryKeys } from '../lib/query-keys.ts'
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
    <section className="panel panel-flush flex min-h-0 flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-3 bg-elevated/55 px-3.5 py-2">
        <p className="min-w-0 flex-1 truncate font-mono text-[0.7rem] text-info">
          {artifact.data?.artifact.path ?? 'Loading…'}
        </p>
        {artifact.data && (
          <span className="hidden shrink-0 font-mono text-[0.6rem] text-muted sm:inline">
            {formatTimestamp(artifact.data.artifact.updatedAt)}
          </span>
        )}
        <button type="button" className="button-ghost shrink-0" onClick={onClose}>
          ← thread
        </button>
      </header>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        {artifact.isPending && <p className="font-mono text-xs text-muted">Loading document…</p>}
        {artifact.isError && (
          <p className="field-error">Artifact unavailable: {artifact.error.message}</p>
        )}
        {artifact.data && (
          <article className="artifact-document min-w-0">
            <ArtifactMarkdown content={artifact.data.artifact.content ?? ''} />
          </article>
        )}
      </div>
    </section>
  )
}
