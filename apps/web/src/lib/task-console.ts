import { type BudgetKey, isTerminal, spendAgainstBudget } from '@specmate/core'
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

/** The accent the console wears — one per state, never decorative. */
export type ConsoleTone = 'asking' | 'running' | 'stopped' | 'spent' | 'plain'

export interface ConsoleHead {
  /** What receives the text: a node, a gate, or plainly `nowhere`. */
  readonly to: string
  readonly note: string
}

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
  readonly tone: ConsoleTone
  /** The primary button's verb, in the state's own words. */
  readonly submit: string
  readonly placeholder: string
  /**
   * The destination stated above the input. Null while a question is open or a
   * node is running: those states head the console with the question itself or
   * say it in the footer, and a second copy above a footer that already states
   * it is the duplication this pass removes.
   */
  readonly head: ConsoleHead | null
}

interface ConsoleInput {
  readonly task: TaskDetail['task']
  readonly stages: readonly Stage[]
  readonly nodes: readonly PipelineNodeView[]
  readonly openDecisions: readonly DecisionItem[]
  readonly gateKey: string | null
  /** The gate's redirect budget, where the gate has a redirect edge at all. */
  readonly redirect?: { readonly used: number; readonly limit: number } | null
  readonly interruptedStage: Stage | null
  readonly spend: TaskDetail['spend']
  /** A discussion the owner opened from a question — not a mode they set. */
  readonly discussingDecision: DecisionItem | null
}

/** What the cap says it spent, in the unit the owner set it in. */
function spentNote(
  spend: TaskDetail['spend'],
  budgets: TaskDetail['task']['budgets'],
  key: BudgetKey,
): string {
  const used = spendAgainstBudget(spend, key)

  return key === 'max_cost_usd'
    ? `$${used.toFixed(2)} of $${budgets.max_cost_usd.toFixed(2)} spent`
    : `${used.toFixed(0)} of ${budgets.max_wall_clock_minutes} agent-minutes spent`
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
  redirect = null,
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
      line: 'Asking the guide about this question',
      unavailable: null,
      tone: 'plain',
      submit: 'Ask',
      placeholder: 'Ask the guide about this question…',
      head: { to: 'the guide', note: 'costs a model call' },
    }
  }

  if (isTerminal(task.status) || task.status === 'archived') {
    return {
      kind: 'nowhere',
      nodeKey: null,
      label: 'Note on the record',
      line: 'This task is finished. Nothing will read a new message.',
      unavailable: 'The task is finished.',
      tone: 'spent',
      submit: 'Send',
      placeholder: 'The task is finished.',
      head: { to: 'nowhere', note: 'the task is finished' },
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
      tone: 'asking',
      submit: 'Answer',
      placeholder: 'Answer…',
      head: null,
    }
  }

  if (gateKey) {
    const left = redirect ? redirect.limit - redirect.used : 0

    return {
      kind: 'gate',
      nodeKey: gateKey,
      label: 'Gate comment',
      line: redirect ? `${left} of ${redirect.limit} redirects left` : '',
      unavailable: null,
      tone: 'asking',
      submit: 'Approve',
      placeholder: 'Say why, if it needs saying…',
      head: { to: nodeLabel(gateKey), note: 'your call' },
    }
  }

  if (interruptedStage) {
    const attempts = interruptedStage.attempt + 1
    const node = nodeLabel(interruptedStage.nodeKey)

    return {
      kind: 'restart',
      nodeKey: interruptedStage.nodeKey,
      label: 'Guidance for the restart',
      // REQ-914 wants the loss stated plainly, and this is the moment it is
      // about to happen — not a panel the owner has to open to find it.
      line: `Carried into the restart as guidance · ${node}'s uncommitted work is already gone`,
      unavailable: null,
      tone: 'stopped',
      submit: 'Restart',
      placeholder: 'What should it do differently this time…',
      head: {
        to: node,
        note: attempts > 1 ? `stopped after ${attempts} attempts` : 'stopped mid-run',
      },
    }
  }

  const spent = exhaustedBudget(spend, task.budgets)
  if (spent) {
    return {
      kind: 'nowhere',
      nodeKey: null,
      label: 'Note on the record',
      line: 'Nothing will run until the cap moves',
      unavailable: 'The budget is spent.',
      tone: 'spent',
      submit: 'Send',
      placeholder: 'Raise the cap to send anything',
      head: { to: 'nowhere', note: spentNote(spend, task.budgets, spent) },
    }
  }

  const running = stages.find((stage) => stage.status === 'running')
  if (running) {
    const node = nodeLabel(running.nodeKey)

    return {
      kind: 'running-node',
      nodeKey: running.nodeKey,
      label: `Message to ${node.toLowerCase()}`,
      // A stage seals its prompt at dispatch, so this is the honest tense.
      line: `Picked up by ${node} on its next run`,
      unavailable: null,
      tone: 'running',
      submit: 'Send',
      placeholder: `Ask ${node} something, or steer it…`,
      head: null,
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
      tone: 'plain',
      submit: 'Send',
      placeholder: `Anything ${next.label} should know…`,
      head: null,
    }
  }

  return {
    kind: 'nowhere',
    nodeKey: null,
    label: 'Note on the record',
    line: 'No stage is left to read this.',
    unavailable: 'Nothing is left to run.',
    tone: 'spent',
    submit: 'Send',
    placeholder: 'Nothing is left to run.',
    head: { to: 'nowhere', note: 'no stage is left to read this' },
  }
}
