import type { ModelBinding } from '@specmate/core'
import type { TaskDetail, TaskSummary } from '../lib/api-client.ts'
import type { PipelineNodeView } from '../lib/task-pipeline.ts'
import { BudgetPanel } from './budget-panel.tsx'
import { HarnessBadge } from './harness-badge.tsx'
import { PipelineRail } from './pipeline-rail.tsx'
import { PlanBadge } from './plan-badge.tsx'
import { TaskLineage } from './task-lineage.tsx'

interface TaskRailProps {
  readonly nodes: readonly PipelineNodeView[]
  readonly baseline: ModelBinding | null
  readonly repoUrl: string
  readonly selectedKey: string | null
  readonly onSelect: (key: string) => void
  readonly task: TaskDetail['task']
  readonly tasks: readonly TaskSummary[] | undefined
  readonly spend: TaskDetail['spend']
}

/**
 * The machine's column: what shaped this run, the walk itself, and what it has
 * spent. The artifact list and the `files changed →` link that used to sit here
 * are gone — those counts belong to the tabs, and no fact is stated twice.
 */
export function TaskRail({
  nodes,
  baseline,
  repoUrl,
  selectedKey,
  onSelect,
  task,
  tasks,
  spend,
}: TaskRailProps) {
  return (
    <div className="space-y-7">
      <section aria-label="Task shape" className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <HarnessBadge status={task.harnessStatus} />
          <PlanBadge size={task.planSize} />
        </div>
        <TaskLineage originTaskId={task.originTaskId} blockedBy={task.blockedBy} tasks={tasks} />
      </section>

      <PipelineRail
        nodes={nodes}
        baseline={baseline}
        repoUrl={repoUrl}
        selectedKey={selectedKey}
        onSelect={onSelect}
      />

      <BudgetPanel budgets={task.budgets} spend={spend} />
    </div>
  )
}
