import { isTerminal } from '@specmate/core'
import { useQuery } from '@tanstack/react-query'
import { useLocation } from 'wouter'
import { listAttention, listTasks, type TaskSummary } from '../lib/api-client.ts'
import { queryKeys } from '../lib/query-keys.ts'
import { nodeLabel } from '../lib/task-thread.ts'
import { cn, Dot, MicroLabel, NavRow, Note, SkeletonRows, Waiting } from '../ui/index.ts'
import { TaskActions } from './task-actions.tsx'
import { signalText, statusTone, toneDot } from './tone.ts'

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

  // The rail is on every screen, so its wait is the one the owner sees most. A
  // sentence in the corner emptied the whole sidebar on every reload; the rows
  // keep the column's shape while its contents are on the way.
  if (tasks.isPending || attention.isPending) {
    return (
      <Waiting label="Loading task index…" className="py-1">
        <SkeletonRows rows={6} mark />
      </Waiting>
    )
  }
  if (tasks.isError || attention.isError) {
    return <p className={cn('py-4 text-sm', signalText('stopped'))}>Task index unavailable.</p>
  }

  return (
    <nav aria-label="Tasks" className="space-y-7">
      {GROUPS.map((group) => {
        const rows = grouped.get(group) ?? []
        if (rows.length === 0) {
          return null
        }

        // Two groups earn the breath — what is moving, and what is waiting on
        // you — and only the second earns the halo, because only it is a
        // question. Neither of them gets an edge: no ring around the row.
        const asking = group === 'Needs input'
        const breathing = asking || group === 'Active'

        return (
          <section key={group}>
            <MicroLabel as="h2">{group}</MicroLabel>

            <ul className="mt-0.5 space-y-0.5">
              {rows.map((task) => {
                const current = location.startsWith(`/tasks/${task.id}`)

                return (
                  <li key={task.id} className="group relative">
                    <NavRow
                      href={`/tasks/${task.id}`}
                      active={current}
                      title={task.title}
                      className="flex gap-2.5 pr-8"
                    >
                      {/* Centred on the title's own line rather than nudged down
                          by a hand-measured margin, so the mark keeps its place
                          whatever the row's text size settles at. */}
                      <span className="flex h-5 items-center">
                        <Dot
                          className={toneDot(statusTone(task.status))}
                          live={breathing}
                          halo={asking}
                        />
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.82rem] leading-5">
                          {task.title}
                        </span>
                        <span className="mt-0.5 block truncate font-mono text-[0.66rem]/4 text-muted-foreground">
                          {nodeLabel(task.status)}
                        </span>
                      </span>
                    </NavRow>

                    {/* On the title's line and a mark's width in from the row's
                        own edge, so the trigger answers the dot across the row
                        rather than floating between its two lines. */}
                    <div className="absolute right-[calc(var(--rail-gutter)/-2)] top-2 z-10 flex h-5 items-center">
                      <TaskActions task={task} current={current} />
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}

      {(tasks.data?.tasks.length ?? 0) === 0 && <Note>No tasks launched yet.</Note>}
    </nav>
  )
}
