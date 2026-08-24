import type { TaskDetail } from '../lib/api-client.ts'
import type { PipelineNodeView } from '../lib/task-pipeline.ts'
import { BudgetPanel } from './budget-panel.tsx'
import { PipelineRail } from './pipeline-rail.tsx'

interface TaskRailProps {
  readonly nodes: readonly PipelineNodeView[]
  readonly selectedKey: string | null
  readonly onSelect: (key: string) => void
  readonly task: TaskDetail['task']
  readonly spend: TaskDetail['spend']
}

/**
 * The machine's column: the walk itself, and what it has spent. Two sections
 * and nothing else — the harness and plan chips qualify the header's state
 * sentence and live there; the artifact and file counts belong to the tabs.
 * What a step is doing is read in the step, not squeezed into its row here.
 */
export function TaskRail({ nodes, selectedKey, onSelect, task, spend }: TaskRailProps) {
  return (
    <div className="space-y-7">
      <PipelineRail nodes={nodes} selectedKey={selectedKey} onSelect={onSelect} />

      <BudgetPanel budgets={task.budgets} spend={spend} />
    </div>
  )
}
