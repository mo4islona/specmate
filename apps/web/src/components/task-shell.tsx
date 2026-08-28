import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useTaskStream } from '../hooks/use-task-stream.ts'
import {
  getTask,
  listArtifacts,
  listDecisions,
  listDiffFiles,
  listTasks,
} from '../lib/api-client.ts'
import { queryKeys } from '../lib/query-keys.ts'
import { surfaceRef } from '../lib/repo-link.ts'
import { usePublishStreamStatus } from '../lib/stream-status.ts'
import { taskStateSentence } from '../lib/task-state.ts'
import { ErrorState, LoadingState } from '../ui/index.ts'
import { HarnessBadge } from './harness-badge.tsx'
import { PlanBadge } from './plan-badge.tsx'
import { RepoRef } from './repo-ref.tsx'
import { TaskHeader } from './task-header.tsx'
import { TaskLineage } from './task-lineage.tsx'
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
  // Opened here, reported in the sidebar: the shell's mark is what says whether
  // the screen is keeping up, so the state has to leave this tree.
  usePublishStreamStatus(useTaskStream(taskId))
  const detail = useQuery({
    queryKey: queryKeys.task(taskId),
    queryFn: ({ signal }) => getTask(taskId, signal),
  })
  const decisions = useQuery({
    queryKey: queryKeys.decisions(taskId),
    queryFn: ({ signal }) => listDecisions(taskId, signal),
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
  // Shared with the navigation's own list under the same key: the lineage needs
  // titles for a handful of ids, not a fetch per id.
  const tasks = useQuery({
    queryKey: queryKeys.tasks,
    queryFn: ({ signal }) => listTasks(signal),
  })

  if (detail.isPending) {
    return <LoadingState title="Loading task channel…" shape="document" />
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
  const ref = surfaceRef(active, task.baseBranch)

  return (
    <div className="xl:h-[calc(100vh-2*var(--shell-gutter))] flex min-w-0 flex-col gap-3">
      <div className="shrink-0">
        <TaskHeader
          title={task.title}
          state={state}
          badges={
            <span className="flex flex-wrap items-center gap-2">
              <HarnessBadge status={task.harnessStatus} />
              <PlanBadge size={task.planSize} />
            </span>
          }
        />

        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-5 gap-y-1">
          <TaskNav
            taskId={taskId}
            active={active}
            fileCount={files.data?.total ?? null}
            docCount={artifacts.data?.artifacts.length ?? null}
          />

          <RepoRef repoUrl={task.repoUrl} ref={ref} pullRequest={detail.data.pullRequest} />
        </div>

        <TaskLineage
          originTaskId={task.originTaskId}
          blockedBy={task.blockedBy}
          tasks={tasks.data?.tasks}
        />
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </div>
  )
}
