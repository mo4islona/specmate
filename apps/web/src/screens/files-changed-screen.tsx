import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { DiffViewer } from '../components/diff-viewer.tsx'
import { ListDetailPanel } from '../components/list-detail-panel.tsx'
import { ErrorState, LoadingState } from '../components/query-state.tsx'
import { type DiffFileSummary, getFileDiff, listDiffFiles } from '../lib/api-client.ts'
import { queryKeys } from '../lib/query-keys.ts'

interface FilesChangedScreenProps {
  taskId: string
}

const STATUS_LABEL: Record<DiffFileSummary['status'], string> = {
  added: 'added',
  modified: 'modified',
  deleted: 'deleted',
  'type-changed': 'type changed',
}

export function StatCounts({ file }: { file: DiffFileSummary }) {
  if (file.additions === null || file.deletions === null) {
    return <span className="font-mono text-[0.65rem] text-muted">binary</span>
  }

  return (
    <span className="font-mono text-[0.65rem]">
      <span className="text-success">+{file.additions}</span>{' '}
      <span className="text-danger">-{file.deletions}</span>
    </span>
  )
}

export function FilesChangedScreen({ taskId }: FilesChangedScreenProps) {
  const [selected, setSelected] = useState<string | null>(null)

  const files = useQuery({
    queryKey: queryKeys.diffFiles(taskId),
    queryFn: ({ signal }) => listDiffFiles(taskId, signal),
  })
  const diff = useQuery({
    queryKey: queryKeys.diffFile(taskId, selected ?? 'none'),
    queryFn: ({ signal }) => getFileDiff(taskId, selected ?? '', signal),
    enabled: Boolean(selected),
  })

  if (files.isPending) {
    return <LoadingState title="Computing the task's code diff…" />
  }
  if (files.isError) {
    return <ErrorState title="Code diff unavailable" detail={files.error.message} />
  }

  const rows = files.data.files

  return (
    <div className="min-h-0 min-w-0 flex-1 space-y-4">
      {rows.length === 0 && (
        <div className="panel grid min-h-48 place-items-center text-center">
          <p className="text-sm text-muted">No product-code changes have been committed yet.</p>
        </div>
      )}

      {rows.length > 0 && (
        <ListDetailPanel
          selectedId={selected}
          isPending={diff.isPending}
          isError={diff.isError}
          error={diff.error}
          notSelectedLabel="Select a file to read its diff."
          loadingLabel="Loading diff…"
          errorTitle="Diff unavailable"
          sidebar={
            <ul className="space-y-0.5">
              {rows.map((file) => (
                <li key={file.path}>
                  <button
                    type="button"
                    onClick={() => setSelected(file.path)}
                    className={`block w-full min-w-0 rail-row rounded-lg py-2 text-left text-sm transition-colors ${
                      selected === file.path
                        ? 'bg-accent/[0.09] text-text'
                        : 'text-muted hover:bg-text/[0.05] hover:text-text'
                    }`}
                  >
                    <span className="block truncate font-mono text-xs">{file.path}</span>
                    <span className="mt-1 flex items-center gap-2 text-muted">
                      <span className="micro-label">{STATUS_LABEL[file.status]}</span>
                      <StatCounts file={file} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          }
        >
          {diff.data && (
            <>
              <header className="sticky top-0 z-10 bg-elevated px-4 py-3 sm:px-6">
                <p className="break-all font-mono text-xs text-info">{diff.data.path}</p>
              </header>
              <div className="min-w-0 overflow-x-auto py-4">
                <DiffViewer diff={diff.data.diff} />
              </div>
            </>
          )}
        </ListDetailPanel>
      )}
    </div>
  )
}
