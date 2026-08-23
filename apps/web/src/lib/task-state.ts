import { type BudgetKey, isTerminal, spendAgainstBudget } from '@specmate/core'
import type { DecisionItem, TaskDetail } from './api-client.ts'
import { formatDuration, nodeLabel } from './task-thread.ts'

type Stage = TaskDetail['stages'][number]
type Budgets = TaskDetail['task']['budgets']
type Spend = TaskDetail['spend']

export type StateTone = 'running' | 'attention' | 'stopped' | 'done'

export interface TaskStateSentence {
  readonly tone: StateTone
  /** Two or three words: what the task is doing. */
  readonly headline: string
  /** Why, in the owner's terms — null when the headline says all of it. */
  readonly detail: string | null
}

const BUDGET_KEYS: readonly BudgetKey[] = ['max_cost_usd', 'max_wall_clock_minutes']

/** A budget is spent when any one of its caps is reached; the first one that is decides the sentence. */
export function exhaustedBudget(spend: Spend, budgets: Budgets): BudgetKey | null {
  return (
    BUDGET_KEYS.find((key) => budgets[key] > 0 && spendAgainstBudget(spend, key) >= budgets[key]) ??
    null
  )
}

function questionsFrom(decisions: readonly DecisionItem[]): string {
  const nodes = new Set(decisions.map((decision) => decision.nodeKey).filter(Boolean))
  const count = decisions.length
  const noun = count === 1 ? 'question' : 'questions'
  const [only] = [...nodes]

  return nodes.size === 1 && only
    ? `${count} ${noun} from ${nodeLabel(only).toLowerCase()}`
    : `${count} ${noun}`
}

/**
 * The header's one sentence (REQ-920). Derived from the task read and its open
 * decisions alone — both of which every surface already holds — so the sentence
 * is identical on the thread, the files, and the documents rather than richer
 * wherever the event stream happens to be loaded.
 */
export function taskStateSentence(input: {
  task: TaskDetail['task']
  stages: readonly Stage[]
  decisions: readonly DecisionItem[]
  spend: Spend
  now?: number
}): TaskStateSentence {
  const { task, stages, decisions, spend, now = Date.now() } = input
  const open = decisions.filter((decision) => decision.status === 'open')

  if (task.status === 'failed') {
    return { tone: 'stopped', headline: 'Stopped', detail: stoppedReason(stages) }
  }
  if (isTerminal(task.status)) {
    return {
      tone: 'done',
      headline: task.status === 'cancelled' ? 'Cancelled' : 'Finished',
      detail: null,
    }
  }

  const running = stages.find((stage) => stage.status === 'running')
  if (running) {
    const started = running.startedAt ? new Date(running.startedAt).getTime() : null
    const elapsed = started === null ? null : formatDuration(now - started)

    return {
      tone: 'running',
      headline: nodeLabel(running.nodeKey),
      detail: elapsed ? `running for ${elapsed}` : 'running',
    }
  }

  if (task.status === 'paused') {
    const spent = exhaustedBudget(spend, task.budgets)
    if (spent) {
      return { tone: 'stopped', headline: 'Paused', detail: 'the budget is spent' }
    }

    return { tone: 'stopped', headline: 'Stopped', detail: stoppedReason(stages) }
  }

  if (open.length > 0) {
    return { tone: 'attention', headline: 'Waiting on you', detail: questionsFrom(open) }
  }
  if (task.status.startsWith('human_')) {
    return {
      tone: 'attention',
      headline: 'Waiting on you',
      detail: `${nodeLabel(task.status).toLowerCase()} is yours to call`,
    }
  }
  if (task.status === 'waiting_human' || task.status === 'blocked') {
    return { tone: 'attention', headline: 'Waiting on you', detail: null }
  }

  return { tone: 'running', headline: nodeLabel(task.status), detail: 'queued' }
}

/** What the client can honestly say about a stop: the last attempt's own outcome. */
function stoppedReason(stages: readonly Stage[]): string | null {
  const last = [...stages]
    .filter((stage) => stage.status === 'failed' || stage.status === 'interrupted')
    .sort((left, right) => attemptOrder(left) - attemptOrder(right))
    .at(-1)
  if (!last) return null

  const node = nodeLabel(last.nodeKey)
  const attempts = last.attempt + 1

  return last.status === 'interrupted'
    ? `${node} was stopped mid-run`
    : `${node} failed${attempts > 1 ? ` ${attempts} times` : ''}`
}

function attemptOrder(stage: Stage): number {
  const finished = stage.finishedAt ? new Date(stage.finishedAt).getTime() : 0

  return finished || stage.attempt
}
