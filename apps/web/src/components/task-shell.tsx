import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useTaskStream } from '../hooks/use-task-stream.ts'
import { getTask, listArtifacts, listDecisions, listDiffFiles } from '../lib/api-client.ts'
import { queryKeys } from '../lib/query-keys.ts'
import { repoLabel } from '../lib/repo-link.ts'
import { taskStateSentence } from '../lib/task-state.ts'
import { ErrorState, LoadingState } from './query-state.tsx'
import { TaskHeader } from './task-header.tsx'
import { TaskNav, type TaskSurface } from './task-nav.tsx'

interface TaskShellProps {
  readonly taskId: string
  readonly active: TaskSurface
  readonly children: ReactNode
}

/**
 * The one header and the one navigation, shared by every surface of a task.
 * The child screens read the same query keys, so nothing here costs a second
 * request — and the event stream is opened once, here, rather than once per
 * surface that happens to want it.
 */
export function TaskShell({ taskId, active, children }: TaskShellProps) {
  const connection = useTaskStream(taskId)
  const detail = useQuery({
    queryKey: queryKeys.task(taskId),
    queryFn: ({ signal }) => getTask(taskId, signal),
  })
  const decisions = useQuery({
    queryKey: queryKeys.decisions(taskId),
    queryFn: () => listDecisions(taskId),
  })
  const artifacts = useQuery({
    queryKey: queryKeys.artifacts(taskId),
    queryFn: ({ signal }) => listArtifacts(taskId, signal),
  })
  // The count belongs to the tab on every surface, so it is fetched on every
  // surface. It is the slowest of the four (it shells out to git), which is why
  // the tab renders without a count until it lands rather than waiting on it.
  const files = useQuery({
    queryKey: queryKeys.diffFiles(taskId),
    queryFn: ({ signal }) => listDiffFiles(taskId, signal),
  })

  if (detail.isPending) {
    return <LoadingState title="Loading task channel…" />
  }
  if (detail.isError) {
    return <ErrorState title="Task unavailable" detail={detail.error.message} />
  }

  const task = detail.data.task
  const state = taskStateSentence({
    task,
    stages: detail.data.stages,
    decisions: decisions.data?.decisions ?? [],
    spend: detail.data.spend,
  })
  const repo = repoLabel(task.repoUrl)
  const context =
    active === 'files' ? `${repo} · ${task.baseBranch} … head` : `${repo} · ${task.baseBranch}`

  return (
    <div className="flex min-w-0 flex-col gap-3 xl:h-[calc(100vh-5rem)]">
      <TaskHeader title={task.title} state={state} context={context} connection={connection} />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 lg:flex-row lg:gap-5">
        <TaskNav
          taskId={taskId}
          active={active}
          fileCount={files.data?.files.length ?? null}
          docCount={artifacts.data?.artifacts.length ?? null}
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </div>
  )
}
