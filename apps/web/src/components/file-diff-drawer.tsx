import { useQuery } from '@tanstack/react-query'
import { getFileDiff } from '../lib/api-client.ts'
import { queryKeys } from '../lib/query-keys.ts'
import { Diff, Drawer, ErrorState, LoadingState, Note } from '../ui/index.ts'

interface FileDiffDrawerProps {
  readonly taskId: string
  /** The file to read, repository-relative. Null while nothing is open. */
  readonly path: string | null
  readonly onClose: () => void
}

/**
 * One file's whole diff, over the surface the owner is on (REQ-916). The read
 * is keyed by path, so opening the same file twice inside a session draws it
 * from cache rather than from git.
 */
export function FileDiffDrawer({ taskId, path, onClose }: FileDiffDrawerProps) {
  const diff = useQuery({
    queryKey: queryKeys.diffFile(taskId, path ?? 'none'),
    queryFn: ({ signal }) => getFileDiff(taskId, path ?? '', signal),
    enabled: path !== null,
  })

  return (
    <Drawer
      open={path !== null}
      onDismiss={onClose}
      label="File diff"
      detail={<p className="mt-1 break-all font-mono text-xs text-muted">{path}</p>}
    >
      {diff.isPending && <LoadingState title="Loading diff…" shape="code" />}
      {diff.isError && <ErrorState title="Diff unavailable" detail={diff.error.message} />}
      {diff.data &&
        (diff.data.diff.trim() === '' ? (
          <Note className="p-6">
            This task's comparison has nothing for this file — it was changed inside a run whose
            work was never committed, or it has since been changed back.
          </Note>
        ) : (
          <div className="min-w-0 p-4 sm:p-6">
            <Diff diff={diff.data.diff} path={path ?? undefined} lineNumbers />
          </div>
        ))}
    </Drawer>
  )
}
