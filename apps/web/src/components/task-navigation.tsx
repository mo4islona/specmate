import { isTerminal } from '@specmate/core'
import { useQuery } from '@tanstack/react-query'
import { useLocation } from 'wouter'
import { listAttention, listTasks, type TaskSummary } from '../lib/api-client.ts'
import { queryKeys } from '../lib/query-keys.ts'
import { nodeLabel } from '../lib/task-thread.ts'
import { Dot, MicroLabel, NavRow, Note } from '../ui/index.ts'
import { statusTone, toneDot } from './status-tone.ts'

const GROUPS = ['Needs input', 'Active', 'Queued', 'Complete'] as const
type TaskGroup = (typeof GROUPS)[number]

export function taskGroup(task: TaskSummary, attentionTaskIds: ReadonlySet<string>): TaskGroup {
  if (attentionTaskIds.has(task.id)) {
    return 'Needs input'
  }
  if (isTerminal(task.status)) {
    return 'Complete'
  }
  if (task.status === 'draft' || task.status === 'paused' || task.status === 'blocked') {
    return 'Queued'
  }

  return 'Active'
}

export function TaskNavigation() {
  const [location] = useLocation()
  const tasks = useQuery({ queryKey: queryKeys.tasks, queryFn: ({ signal }) => listTasks(signal) })
  const attention = useQuery({
    queryKey: queryKeys.attention,
    queryFn: ({ signal }) => listAttention(signal),
  })
  const attentionTaskIds = new Set(attention.data?.items.map((item) => item.task.id) ?? [])
  const grouped = new Map<TaskGroup, TaskSummary[]>(GROUPS.map((group) => [group, []]))
  for (const task of tasks.data?.tasks ?? []) {
    grouped.get(taskGroup(task, attentionTaskIds))?.push(task)
  }

  if (tasks.isPending || attention.isPending) {
    return <p className="py-4 font-mono text-xs text-muted">Loading task index…</p>
  }
  if (tasks.isError || attention.isError) {
    return <p className="py-4 text-sm text-danger">Task index unavailable.</p>
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
            <MicroLabel as="h2">{group}</MicroLabel>

            <ul className="mt-2 space-y-0.5">
              {rows.map((task) => (
                <li key={task.id}>
                  <NavRow
                    href={`/tasks/${task.id}`}
                    active={location.startsWith(`/tasks/${task.id}`)}
                    title={task.title}
                    className={`flex gap-2.5 ${group === 'Needs input' ? 'attention-pulse' : ''}`}
                  >
                    <Dot
                      className={`mt-[0.42rem] ${toneDot(statusTone(task.status))}`}
                      live={group === 'Active'}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.82rem] leading-5">{task.title}</span>
                      <span className="mt-0.5 block truncate font-mono text-[0.66rem] text-muted">
                        {nodeLabel(task.status)}
                      </span>
                    </span>
                  </NavRow>
                </li>
              ))}
            </ul>
          </section>
        )
      })}

      {(tasks.data?.tasks.length ?? 0) === 0 && <Note>No tasks launched yet.</Note>}
    </nav>
  )
}
