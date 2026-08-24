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
  | 'step-note'
  | 'running-node'
  | 'next-node'
  | 'nowhere'

/** The accent the console wears — one per state, never decorative. */
export type ConsoleTone = 'asking' | 'running' | 'stopped' | 'spent' | 'plain'

export interface ConsoleHead {
  /**
   * What receives the text: a node, a gate, or plainly `nowhere`. Null where
   * that is the step the thread is already headed by — the console restating
   * the node above it is the same fact a third time.
   */
  readonly to: string | null
  readonly note: string
}

export interface ConsoleDestination {
  readonly kind: DestinationKind
  /** The node the text is stored against, where there is one. */
  readonly nodeKey: string | null
  /** The input's own name, read by anyone who cannot see the layout. */
  readonly label: string
  /** Set when the state has no destination — the input is unavailable and says why. */
  readonly unavailable: string | null
  readonly tone: ConsoleTone
  /** The primary button's verb, in the state's own words. */
  readonly submit: string
  readonly placeholder: string
  /**
   * The destination stated above the input, and only where the state needs
   * qualifying: a discussion the owner is inside, a cap that is spent, a stop
   * whose work is already gone. Null while a question is open, or while the
   * placeholder already names the node the text goes to — a sentence repeating
   * the field beneath it is the line this pass deletes.
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
  /**
   * A step the owner pinned themselves, older than the one the task stands on
   * (REQ-906). Typing while reading what a stage did is how a comment is pinned
   * to that stage — there is no list of stages to choose from anywhere.
   */
  readonly readingStep?: { readonly nodeKey: string; readonly label: string } | null
  /** The step the thread is headed by, whose name the console must not repeat. */
  readonly stepKey?: string | null
}

function startedAt(stage: Stage): number {
  return stage.startedAt ? new Date(stage.startedAt).getTime() : 0
}

/**
 * The stop the task is still standing on, if it is standing on one.
 *
 * An interrupted stage keeps that status for the rest of the task's life, so
 * the newest interrupted row is a fact about the past rather than the present:
 * after a restart it is still there, and the console went on wearing the red
 * edge and offering to restart a run that had already resumed. The server takes
 * a restart only while the task is paused on that node (REQ-914) — the same
 * pair is what makes a stop current here.
 */
export function parkedStop(
  task: Pick<TaskDetail['task'], 'status' | 'resumeStatus'> | null,
  stages: readonly Stage[],
): Stage | null {
  if (task?.status !== 'paused' || !task.resumeStatus) return null

  const stopped = stages.filter(
    (stage) => stage.status === 'interrupted' && stage.nodeKey === task.resumeStatus,
  )

  return stopped.sort((left, right) => startedAt(right) - startedAt(left))[0] ?? null
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
 *
 * What it says about that destination is trimmed against what the screen has
 * already said: the step's header names the node, so the console names only
 * what the header does not — the qualifier, the loss, the cap.
 */
export function consoleDestination(input: ConsoleInput): ConsoleDestination {
  const destination = destinationFor(input)
  const repeatsStep = destination.nodeKey !== null && destination.nodeKey === input.stepKey
  if (!repeatsStep || !destination.head) return destination

  return { ...destination, head: { ...destination.head, to: null } }
}

function destinationFor({
  task,
  stages,
  nodes,
  openDecisions,
  gateKey,
  redirect = null,
  interruptedStage,
  spend,
  discussingDecision,
  readingStep = null,
}: ConsoleInput): ConsoleDestination {
  // Opening a question's discussion is not a mode: the owner acted on a
  // specific question, and the input follows what they opened. Closing the
  // discussion hands the input back to the answer.
  if (discussingDecision) {
    return {
      kind: 'discussion',
      nodeKey: discussingDecision.nodeKey ?? null,
      label: 'Question for the guide',
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
      unavailable: 'The task is finished.',
      tone: 'spent',
      submit: 'Send',
      placeholder: 'The task is finished.',
      head: { to: 'nowhere', note: 'the task is finished' },
    }
  }

  const [question] = openDecisions
  if (question) {
    return {
      kind: 'question',
      nodeKey: question.nodeKey ?? null,
      label: 'Your answer',
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
      unavailable: null,
      tone: 'asking',
      submit: 'Approve',
      placeholder: 'Say why, if it needs saying…',
      head: {
        to: nodeLabel(gateKey),
        note: redirect ? `${left} of ${redirect.limit} redirects left` : 'your call',
      },
    }
  }

  if (interruptedStage) {
    const attempts = interruptedStage.attempt + 1
    const node = nodeLabel(interruptedStage.nodeKey)

    return {
      kind: 'restart',
      nodeKey: interruptedStage.nodeKey,
      label: 'Guidance for the restart',
      unavailable: null,
      tone: 'stopped',
      submit: 'Restart',
      placeholder: 'What should it do differently this time…',
      // REQ-914 wants the loss stated plainly, and this is the moment it is
      // about to happen — not a panel the owner has to open to find it.
      head: {
        to: node,
        note: `${attempts > 1 ? `stopped after ${attempts} attempts` : 'stopped mid-run'} · uncommitted work is already gone`,
      },
    }
  }

  const spent = exhaustedBudget(spend, task.budgets)
  if (spent) {
    return {
      kind: 'nowhere',
      nodeKey: null,
      label: 'Note on the record',
      unavailable: 'The budget is spent.',
      tone: 'spent',
      submit: 'Send',
      placeholder: 'Raise the cap to send anything',
      head: { to: 'nowhere', note: spentNote(spend, task.budgets, spent) },
    }
  }

  // Nothing is being asked of the owner and they have gone back to read an
  // older step: the text is about what they are reading. It is stored against
  // that stage as commentary — no run will read it, and saying so is the point.
  if (readingStep) {
    return {
      kind: 'step-note',
      nodeKey: readingStep.nodeKey,
      label: `Note on ${readingStep.label.toLowerCase()}`,
      unavailable: null,
      tone: 'plain',
      submit: 'Note',
      placeholder: `Note what ${readingStep.label} did…`,
      head: { to: readingStep.label, note: 'pinned to this run · no run reads it' },
    }
  }

  const running = stages.find((stage) => stage.status === 'running')
  if (running) {
    const node = nodeLabel(running.nodeKey)

    return {
      kind: 'running-node',
      nodeKey: running.nodeKey,
      label: `Message to ${node.toLowerCase()}`,
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
    unavailable: 'Nothing is left to run.',
    tone: 'spent',
    submit: 'Send',
    placeholder: 'Nothing is left to run.',
    head: { to: 'nowhere', note: 'no stage is left to read this' },
  }
}
