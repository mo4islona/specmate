import type { BudgetKey, Spend } from './budgets.ts'
import type { LoopKind } from './pipeline.ts'
import {
  type DecisionKind,
  type DecisionRequest,
  type ReviewFinding,
  type ReviewVerdict,
  renderFindingBullets,
} from './result.ts'
import type { Budgets, TaskState } from './state.ts'

export const DECISION_STATUSES = ['open', 'answered', 'dismissed'] as const
export type DecisionStatus = (typeof DECISION_STATUSES)[number]

export interface DecisionOption {
  readonly id: string
  readonly label: string
}

/** What the engine writes to raise a decision — matched by (nodeKey, key) while open. */
export interface DecisionInsert {
  readonly nodeKey: TaskState
  readonly key: string
  readonly kind: DecisionKind
  readonly promptMd: string
  readonly options: readonly DecisionOption[]
  readonly blocking: boolean
}

/** A decision requested by an agent's `RESULT.json`, at the node that asked. */
export function decisionFromRequest(nodeKey: TaskState, request: DecisionRequest): DecisionInsert {
  return {
    nodeKey,
    key: request.key,
    kind: request.kind,
    promptMd: request.prompt_md,
    options: request.options,
    blocking: request.blocking,
  }
}

export interface PartitionedRequests {
  readonly recorded: readonly DecisionRequest[]
  /** Non-blocking questions past the cap: refused, and named in the event log rather than dropped in silence. */
  readonly refused: readonly DecisionRequest[]
}

/**
 * REQ-1208: the floor under how many questions one stage may raise. Blocking
 * requests always pass — dropping one would leave a parked task with nothing
 * open against it (REQ-1201) — and questions pass in the order the stage
 * returned them, so what survives is what the stage thought to say first.
 */
export function partitionRequests(
  requests: readonly DecisionRequest[],
  cap: number,
): PartitionedRequests {
  const recorded: DecisionRequest[] = []
  const refused: DecisionRequest[] = []
  let questions = 0

  for (const request of requests) {
    const capped = !request.blocking && request.kind === 'question'
    if (!capped) {
      recorded.push(request)
      continue
    }

    questions += 1
    if (questions <= cap) recorded.push(request)
    else refused.push(request)
  }

  return { recorded, refused }
}

/** One finding id that stayed on the loop's trailing rounds long enough to stall it. */
export interface StalledFinding {
  readonly id: string
  /** Round numbers it appeared in, most recent first, including the round about to be recorded. */
  readonly rounds: readonly number[]
}

/**
 * The input the engine already has at the point `advance()` returns a park:
 * the cause, the node it parked at, and exactly the evidence REQ-1203 requires
 * to answer without opening the artifacts.
 */
export type EscalationInput =
  | {
      readonly cause: 'escalate'
      readonly nodeKey: TaskState
      readonly loop: LoopKind
      readonly round: number
      readonly verdict: ReviewVerdict
      readonly findings: readonly ReviewFinding[]
    }
  | {
      readonly cause: 'cap_exhausted'
      readonly nodeKey: TaskState
      readonly loop: LoopKind
      readonly round: number
      readonly cap: number
    }
  | {
      readonly cause: 'repeated_finding'
      readonly nodeKey: TaskState
      readonly loop: LoopKind
      readonly round: number
      readonly finding: StalledFinding
    }

/**
 * The engine's own escalation, raised for a park no agent asked for. The key
 * derives from the cause and the round (plus the finding id for a repeat), so
 * parking twice for one cause in one round attaches to the same decision.
 */
export function escalationForPark(input: EscalationInput): DecisionInsert {
  return {
    nodeKey: input.nodeKey,
    key: escalationKey(input),
    kind: 'escalation',
    promptMd: escalationPrompt(input),
    options: [],
    blocking: true,
  }
}

function escalationKey(input: EscalationInput): string {
  switch (input.cause) {
    case 'escalate':
      return `escalate:${input.loop}:${input.round}`
    case 'cap_exhausted':
      return `cap:${input.loop}:${input.round}`
    case 'repeated_finding':
      return `repeat:${input.finding.id}:${input.loop}:${input.round}`
  }
}

function escalationPrompt(input: EscalationInput): string {
  switch (input.cause) {
    case 'escalate':
      return [
        `The ${input.loop} reviewer escalated at round ${input.round} of ${input.nodeKey}.`,
        '',
        `Verdict: ${input.verdict}`,
        '',
        ...renderFindingBullets(input.findings, {
          header: 'Findings from that round:',
          empty: 'The round carried no findings.',
        }),
      ].join('\n')
    case 'cap_exhausted':
      return `The ${input.loop} loop at ${input.nodeKey} spent its cap of ${input.cap} round(s) without approval, through round ${input.round}.`
    case 'repeated_finding': {
      const rounds = input.finding.rounds.join(', ')

      return `Finding \`${input.finding.id}\` at ${input.nodeKey} repeated across rounds ${rounds} of the ${input.loop} loop without resolving.`
    }
  }
}

/**
 * REQ-1503: the engine-raised decision offering to raise an exhausted budget or
 * cancel — a `human_kickoff_gate`-style pipeline node never applies here, since
 * exhaustion pauses a task wherever it was, so the identity lives at `paused`.
 */
export const BUDGET_DECISION_NODE_KEY: TaskState = 'paused'
export const BUDGET_DECISION_KEY = 'budget-exhausted'
export const BUDGET_DECISION_CANCEL_OPTION = 'cancel'

export function budgetRaiseOptionId(budget: BudgetKey): string {
  return `raise:${budget}`
}

/** The budget a raise option targets, or null for any other option id (including `cancel`). */
export function budgetFromRaiseOption(optionId: string): BudgetKey | null {
  if (optionId === budgetRaiseOptionId('max_cost_usd')) return 'max_cost_usd'
  if (optionId === budgetRaiseOptionId('max_wall_clock_minutes')) return 'max_wall_clock_minutes'

  return null
}

const BUDGET_LABELS: Record<BudgetKey, string> = {
  max_cost_usd: 'cost',
  max_wall_clock_minutes: 'agent-minutes',
}

/**
 * What the engine has at the point a dispatch check finds a task exhausted:
 * what it was about to run, its spend, its budgets, and which of the two the
 * spend reached. AC-1508: no bare "continue" — one raise option per reached
 * budget, plus cancel.
 */
export interface BudgetExhaustionInput {
  /** What the task was about to do — a stage's node key, or a description of a conversation dispatch. */
  readonly about: string
  readonly spend: Spend
  readonly budgets: Budgets
  readonly reached: readonly BudgetKey[]
}

export function budgetExhaustionDecision(input: BudgetExhaustionInput): DecisionInsert {
  return {
    nodeKey: BUDGET_DECISION_NODE_KEY,
    key: BUDGET_DECISION_KEY,
    kind: 'escalation',
    promptMd: budgetExhaustionPrompt(input),
    options: [
      ...input.reached.map((budget) => ({
        id: budgetRaiseOptionId(budget),
        label: `Raise the ${BUDGET_LABELS[budget]} budget`,
      })),
      { id: BUDGET_DECISION_CANCEL_OPTION, label: 'Cancel this task' },
    ],
    blocking: true,
  }
}

function budgetExhaustionPrompt(input: BudgetExhaustionInput): string {
  const reachedNames = input.reached.map((budget) => BUDGET_LABELS[budget]).join(' and ')
  const costNote = input.spend.costComplete ? '' : ' (incomplete — some runs reported no cost)'

  return [
    `Spend reached its ${reachedNames} budget before ${input.about} could run.`,
    '',
    `- Cost: $${input.spend.costUsd.toFixed(2)} of $${input.budgets.max_cost_usd.toFixed(2)}${costNote}`,
    `- Agent-minutes: ${input.spend.agentMinutes.toFixed(1)} of ${input.budgets.max_wall_clock_minutes}`,
  ].join('\n')
}

/** A stored decision, as read back from the database, in the shape the log and the resume path need. */
export interface StoredDecision {
  readonly id: string
  readonly nodeKey: string
  readonly key: string
  readonly kind: DecisionKind
  readonly promptMd: string
  readonly options: readonly DecisionOption[]
  readonly blocking: boolean
  readonly status: DecisionStatus
  readonly answerMd: string | null
  readonly answeredBy: string | null
  readonly answeredAt: Date | null
  readonly createdAt: Date
}

/** Whether anything still blocks — the predicate the resume path and the inbox share. */
export function blockingOpen(decisions: readonly StoredDecision[]): boolean {
  return decisions.some((decision) => decision.blocking && decision.status === 'open')
}

/**
 * `decisions.md` — a generated projection, never authored. Deterministic: two
 * renders of one set are byte-identical, and a dismissal never reads as an
 * empty answer.
 */
export function renderDecisionLog(decisions: readonly StoredDecision[]): string {
  const lines = [
    '# Decisions',
    '',
    'Generated from the decision store. Edits here are not read back as answers.',
    '',
  ]

  if (decisions.length === 0) {
    lines.push('No decisions have been raised on this task yet.')

    return `${lines.join('\n')}\n`
  }

  const sorted = [...decisions].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  )
  for (const decision of sorted) {
    lines.push(`## ${decision.nodeKey} — ${decision.key}`, '')
    lines.push(`- Kind: ${decision.kind}`, `- Blocking: ${decision.blocking ? 'yes' : 'no'}`, '')
    lines.push(decision.promptMd.trim(), '')
    if (decision.options.length > 0) {
      lines.push('Options:', '')
      for (const option of decision.options) lines.push(`- \`${option.id}\`: ${option.label}`)
      lines.push('')
    }
    lines.push(...renderResolution(decision), '')
  }

  return `${lines.join('\n')}\n`.replace(/\n{3,}/g, '\n\n')
}

function renderResolution(decision: StoredDecision): string[] {
  if (decision.status === 'open') return ['Status: open.']

  const who = decision.answeredBy ?? 'unknown'
  const when = decision.answeredAt?.toISOString() ?? 'unknown time'
  if (decision.status === 'dismissed') {
    return [
      `Status: dismissed by ${who} at ${when}.`,
      ...(decision.answerMd?.trim() ? [`Reason: ${decision.answerMd.trim()}`] : []),
    ]
  }

  return [`Status: answered by ${who} at ${when}.`, `Answer: ${decision.answerMd?.trim() ?? ''}`]
}
