import type { ModelBinding } from '@specmate/core'
import type { TaskDetail } from '../lib/api-client.ts'
import type { PipelineNodeView } from '../lib/task-pipeline.ts'
import { BudgetPanel } from './budget-panel.tsx'
import { PipelineRail, type RailSub } from './pipeline-rail.tsx'

interface TaskRailProps {
  readonly nodes: readonly PipelineNodeView[]
  readonly baseline: ModelBinding | null
  readonly selectedKey: string | null
  readonly onSelect: (key: string) => void
  readonly task: TaskDetail['task']
  readonly spend: TaskDetail['spend']
  readonly sub: RailSub | null
}

/**
 * The machine's column: the walk itself, and what it has spent. Two sections
 * and nothing else — the harness and plan chips qualify the header's state
 * sentence and live there; the artifact and file counts belong to the tabs.
 */
export function TaskRail({
  nodes,
  baseline,
  selectedKey,
  onSelect,
  task,
  spend,
  sub,
}: TaskRailProps) {
  return (
    <div className="space-y-7">
      <PipelineRail
        nodes={nodes}
        baseline={baseline}
        selectedKey={selectedKey}
        onSelect={onSelect}
        sub={sub}
      />

      <BudgetPanel budgets={task.budgets} spend={spend} />
    </div>
  )
}
