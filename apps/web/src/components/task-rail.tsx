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
    // What has been spent sits at the foot of the column rather than trailing
    // the walk. The pipeline is a list that grows with the task; a total is not
    // part of that list, and following it up and down the rail is what made the
    // two read as one run-on section.
    //
    // `min-h-full` only resolves where the column has a height of its own, which
    // is the wide layout. Under it the rail is inside a disclosure with no
    // height to measure against, and the two sections simply stack.
    <div className="flex min-h-full flex-col">
      <PipelineRail nodes={nodes} selectedKey={selectedKey} onSelect={onSelect} />

      <BudgetPanel budgets={task.budgets} spend={spend} className="mt-auto pt-7" />
    </div>
  )
}
