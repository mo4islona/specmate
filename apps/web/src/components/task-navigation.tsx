import { useQuery } from '@tanstack/react-query'
import { Link, useLocation } from 'wouter'
import { listAttention, listTasks, type TaskSummary } from '../lib/api-client.ts'
import { queryKeys } from '../lib/query-keys.ts'
import { StatusChip } from './status-chip.tsx'

const GROUPS = ['Needs input', 'Active', 'Queued', 'Complete'] as const
type TaskGroup = (typeof GROUPS)[number]

export function taskGroup(task: TaskSummary, attentionTaskIds: ReadonlySet<string>): TaskGroup {
  if (attentionTaskIds.has(task.id)) {
    return 'Needs input'
  }
  if (task.status === 'archived' || task.status === 'cancelled' || task.status === 'failed') {
    return 'Complete'
  }
  if (task.status === 'draft' || task.status === 'paused' || task.status === 'blocked') {
    return 'Queued'
  }

  return 'Active'
}

export function TaskNavigation() {
  const [location] = useLocation()
  const tasks = useQuery({ queryKey: queryKeys.tasks, queryFn: listTasks })
  const attention = useQuery({ queryKey: queryKeys.attention, queryFn: listAttention })
  const attentionTaskIds = new Set(attention.data?.items.map((item) => item.task.id) ?? [])
  const grouped = new Map<TaskGroup, TaskSummary[]>(GROUPS.map((group) => [group, []]))
  for (const task of tasks.data?.tasks ?? []) {
    grouped.get(taskGroup(task, attentionTaskIds))?.push(task)
  }

  if (tasks.isPending || attention.isPending) {
    return <p className="px-3 py-4 font-mono text-xs text-muted">Loading task index…</p>
  }
  if (tasks.isError || attention.isError) {
    return <p className="px-3 py-4 text-sm text-danger">Task index unavailable.</p>
  }

  return (
    <nav aria-label="Tasks" className="space-y-5">
      {GROUPS.map((group) => {
        const rows = grouped.get(group) ?? []
        if (rows.length === 0) {
          return null
        }

        return (
          <section key={group}>
            <h2 className="micro-label px-3 text-muted">{group}</h2>
            <ul className="mt-2 space-y-1">
              {rows.map((task) => {
                const isActive = location.startsWith(`/tasks/${task.id}`)
                const needsInput = taskGroup(task, attentionTaskIds) === 'Needs input'

                return (
                  <li key={task.id}>
                    <Link
                      href={`/tasks/${task.id}`}
                      aria-current={isActive ? 'page' : undefined}
                      className={`block border-l-2 px-3 py-2.5 transition-colors ${
                        isActive
                          ? 'border-phosphor bg-phosphor/8 text-text'
                          : 'border-transparent text-muted hover:border-border-bright hover:bg-elevated hover:text-text'
                      } ${needsInput ? 'attention-pulse' : ''}`}
                    >
                      <span className="block truncate text-sm font-medium">{task.title}</span>
                      <span className="mt-1.5 flex items-center justify-between gap-2">
                        <StatusChip status={task.status} />
                        <span className="truncate font-mono text-[0.62rem] text-muted">
                          {task.slug}
                        </span>
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
      {(tasks.data?.tasks.length ?? 0) === 0 && (
        <p className="px-3 text-sm text-muted">No tasks launched yet.</p>
      )}
    </nav>
  )
}
