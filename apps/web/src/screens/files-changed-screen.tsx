import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { FileDiffDrawer } from '../components/file-diff-drawer.tsx'
import { type DiffFileSummary, listDiffFiles } from '../lib/api-client.ts'
import { queryKeys } from '../lib/query-keys.ts'
import { EmptyState, ErrorState, LoadingState, MicroLabel, NavRow, Panel } from '../ui/index.ts'

interface FilesChangedScreenProps {
  taskId: string
}

const STATUS_LABEL: Record<DiffFileSummary['status'], string> = {
  added: 'added',
  modified: 'modified',
  deleted: 'deleted',
  'type-changed': 'type changed',
}

/** Code first: it is what a reviewer opens the view for once there is any. */
const GROUPS = [
  { id: 'code', label: 'Code' },
  { id: 'spec', label: 'Specification' },
] as const

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
  const [openPath, setOpenPath] = useState<string | null>(null)

  const files = useQuery({
    queryKey: queryKeys.diffFiles(taskId),
    queryFn: ({ signal }) => listDiffFiles(taskId, signal),
  })

  if (files.isPending) {
    return <LoadingState title="Computing the task's diff…" shape="rows" />
  }
  if (files.isError) {
    return <ErrorState title="Diff unavailable" detail={files.error.message} />
  }

  const rows = files.data.files

  return (
    <div className="min-h-0 min-w-0 flex-1 space-y-4">
      {rows.length === 0 && (
        <Panel as="div" flush>
          <EmptyState>This task has not committed any changes yet.</EmptyState>
        </Panel>
      )}

      {rows.length > 0 && (
        <Panel as="div">
          {GROUPS.map((group) => {
            const groupRows = rows.filter((file) => file.group === group.id)
            if (groupRows.length === 0) return null

            return (
              <section key={group.id} className="min-w-0 first:mt-0 mt-5">
                <MicroLabel>
                  {group.label} · {groupRows.length}
                </MicroLabel>

                <ul className="mt-2 space-y-0.5">
                  {groupRows.map((file) => (
                    <li key={file.path}>
                      <NavRow
                        active={false}
                        onClick={() => setOpenPath(file.path)}
                        className="flex min-w-0 items-baseline justify-between gap-3"
                      >
                        <span className="min-w-0 truncate font-mono text-xs">{file.path}</span>
                        <span className="flex shrink-0 items-baseline gap-2">
                          <MicroLabel as="span">{STATUS_LABEL[file.status]}</MicroLabel>
                          <StatCounts file={file} />
                        </span>
                      </NavRow>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </Panel>
      )}

      <FileDiffDrawer taskId={taskId} path={openPath} onClose={() => setOpenPath(null)} />
    </div>
  )
}
