import type { TaskSummary } from '../lib/api-client.ts'
import { InlineLink } from '../ui/index.ts'

interface TaskLineageProps {
  originTaskId: string | null
  blockedBy: readonly string[]
  /** The tasks list, when it is loaded — titles come from there rather than a second fetch per id. */
  tasks: readonly TaskSummary[] | undefined
}

function titleFor(tasks: readonly TaskSummary[] | undefined, id: string): string {
  return tasks?.find((task) => task.id === id)?.title ?? id.slice(0, 8)
}

function TaskLink({ id, tasks }: { id: string; tasks: readonly TaskSummary[] | undefined }) {
  return <InlineLink href={`/tasks/${id}`}>{titleFor(tasks, id)}</InlineLink>
}

/**
 * Both directions of a planned chain (REQ-617): the task whose plan created
 * this one, and the tasks this one is waiting on. Without it, a blocked task
 * shows a status and nothing that explains it.
 */
export function TaskLineage({ originTaskId, blockedBy, tasks }: TaskLineageProps) {
  if (!originTaskId && blockedBy.length === 0) return null

  return (
    <p className="mt-2 text-xs leading-6 text-muted">
      {originTaskId && (
        <span data-lineage="origin">
          Proposed while planning <TaskLink id={originTaskId} tasks={tasks} />
        </span>
      )}
      {originTaskId && blockedBy.length > 0 && <span> · </span>}
      {blockedBy.length > 0 && (
        <span data-lineage="blocked-by">
          Waiting on{' '}
          {blockedBy.map((id, index) => (
            <span key={id}>
              {index > 0 && ', '}
              <TaskLink id={id} tasks={tasks} />
            </span>
          ))}
        </span>
      )}
    </p>
  )
}
