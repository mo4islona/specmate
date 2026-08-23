import { isTerminal } from '@specmate/core'
import type { DecisionItem, TaskDetail } from './api-client.ts'
import type { PipelineNodeView } from './task-pipeline.ts'
import { exhaustedBudget } from './task-state.ts'
import { nodeLabel } from './task-thread.ts'

type Stage = TaskDetail['stages'][number]

export type DestinationKind =
  | 'discussion'
  | 'question'
  | 'gate'
  | 'restart'
  | 'running-node'
  | 'next-node'
  | 'nowhere'

export interface ConsoleDestination {
  readonly kind: DestinationKind
  /** The node the text is stored against, where there is one. */
  readonly nodeKey: string | null
  /** The input's own name, read by anyone who cannot see the layout. */
  readonly label: string
  /** The sentence under the input: what receives the text, and when. */
  readonly line: string
  /** Set when the state has no destination — the input is unavailable and says why. */
  readonly unavailable: string | null
}

interface ConsoleInput {
  readonly task: TaskDetail['task']
  readonly stages: readonly Stage[]
  readonly nodes: readonly PipelineNodeView[]
  readonly openDecisions: readonly DecisionItem[]
  readonly gateKey: string | null
  readonly interruptedStage: Stage | null
  readonly spend: TaskDetail['spend']
  /** A discussion the owner opened from a question — not a mode they set. */
  readonly discussingDecision: DecisionItem | null
}

/**
 * The whole of the console's cleverness, in one pure function (REQ-921). The
 * owner never picks a destination, so this is the only thing standing between
 * what they type and where it lands — which is why it is here, testable, and
 * not spread through the screen's JSX.
 */
export function consoleDestination({
  task,
  stages,
  nodes,
  openDecisions,
  gateKey,
  interruptedStage,
  spend,
  discussingDecision,
}: ConsoleInput): ConsoleDestination {
  // Opening a question's discussion is not a mode: the owner acted on a
  // specific question, and the input follows what they opened. Closing the
  // discussion hands the input back to the answer.
  if (discussingDecision) {
    return {
      kind: 'discussion',
      nodeKey: discussingDecision.nodeKey ?? null,
      label: 'Question for the guide',
      line: 'Asking the guide about this question · costs a model call',
      unavailable: null,
    }
  }

  if (isTerminal(task.status) || task.status === 'archived') {
    return {
      kind: 'nowhere',
      nodeKey: null,
      label: 'Note on the record',
      line: 'This task is finished. Nothing will read a new message.',
      unavailable: 'The task is finished.',
    }
  }

  const [question, ...rest] = openDecisions
  if (question) {
    const after = rest.length
    const target = question.nodeKey ? nodeLabel(question.nodeKey) : 'the task'

    return {
      kind: 'question',
      nodeKey: question.nodeKey ?? null,
      label: 'Your answer',
      line: `Unblocks ${target}${after > 0 ? ` · ${after} question${after > 1 ? 's' : ''} after this one` : ''}`,
      unavailable: null,
    }
  }

  if (gateKey) {
    return {
      kind: 'gate',
      nodeKey: gateKey,
      label: 'Gate comment',
      line: `${nodeLabel(gateKey)} · your call`,
      unavailable: null,
    }
  }

  if (interruptedStage) {
    return {
      kind: 'restart',
      nodeKey: interruptedStage.nodeKey,
      label: 'Guidance for the restart',
      line: `Carried into the restart of ${nodeLabel(interruptedStage.nodeKey).toLowerCase()}`,
      unavailable: null,
    }
  }

  const spent = exhaustedBudget(spend, task.budgets)
  if (spent) {
    return {
      kind: 'nowhere',
      nodeKey: null,
      label: 'Note on the record',
      line: 'Nothing will run until the cap moves.',
      unavailable: 'The budget is spent.',
    }
  }

  const running = stages.find((stage) => stage.status === 'running')
  if (running) {
    return {
      kind: 'running-node',
      nodeKey: running.nodeKey,
      label: `Message to ${nodeLabel(running.nodeKey).toLowerCase()}`,
      // A stage seals its prompt at dispatch, so this is the honest tense.
      line: `Picked up by ${nodeLabel(running.nodeKey)} on its next run`,
      unavailable: null,
    }
  }

  const next = nodes.find((node) => node.kind === 'stage' && node.runs.length === 0)
  if (next) {
    return {
      kind: 'next-node',
      nodeKey: next.key,
      label: `Message to ${next.label.toLowerCase()}`,
      line: `Picked up by ${next.label} when it starts · nothing runs now`,
      unavailable: null,
    }
  }

  return {
    kind: 'nowhere',
    nodeKey: null,
    label: 'Note on the record',
    line: 'No stage is left to read this.',
    unavailable: 'Nothing is left to run.',
  }
}
