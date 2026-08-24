import { isTerminal, type ModelBinding, type TaskState } from '@specmate/core'
import type { TaskDetail } from './api-client.ts'
import { nodeLabel, stageDuration } from './task-thread.ts'

type Stage = TaskDetail['stages'][number]
type ModelBindings = TaskDetail['task']['modelBindings']
type PinnedNode = NonNullable<TaskDetail['graph']>['dag']['nodes'][number]

/**
 * Four states the owner reads, plus the one they do not: `pending` nodes carry
 * no information and fold into a single line. `stopped` is the state the first
 * pass had no colour for — a failed attempt, a spent attempt cap, a run the
 * sweeper found orphaned — and a node in it keeps its facts rather than
 * reverting to looking unstarted.
 */
export type NodeState = 'done' | 'running' | 'stopped' | 'skipped' | 'awaiting' | 'pending'

export interface PipelineNodeView {
  readonly key: string
  readonly kind: PinnedNode['kind']
  readonly label: string
  readonly role: string | null
  readonly binding: ModelBinding | null
  readonly state: NodeState
  /**
   * Why it stopped, or why it was skipped — in the slot a finished node states its
   * duration in. A skipped node keeps its place in the rail precisely so the
   * decision to skip it is visible rather than inferred from an absence.
   */
  readonly reason: string | null
  /** Where the task stands right now — its status, or what it resumes into when parked. */
  readonly current: boolean
  /** Every attempt at this node, oldest first. */
  readonly runs: readonly Stage[]
  readonly latest: Stage | null
}

const STAGE_STATE: Record<string, NodeState> = {
  running: 'running',
  succeeded: 'done',
  failed: 'stopped',
  interrupted: 'stopped',
  waiting_human: 'awaiting',
  skipped: 'skipped',
  pending: 'pending',
}

interface PipelineInput {
  readonly nodes: readonly PinnedNode[]
  readonly stages: readonly Stage[]
  readonly status: TaskState
  readonly resumeStatus: TaskState | null
  readonly modelBindings: ModelBindings
}

export function buildPipelineNodes({
  nodes,
  stages,
  status,
  resumeStatus,
  modelBindings,
}: PipelineInput): PipelineNodeView[] {
  const finished = isTerminal(status)
  const currentIndex = finished
    ? nodes.length
    : nodes.findIndex((node) => node.key === status || node.key === resumeStatus)

  return nodes.map((node, index) => {
    const runs = stages
      .filter((stage) => stage.nodeKey === node.key)
      .sort((left, right) => left.attempt - right.attempt)
    const latest = runs.at(-1) ?? null
    const current = currentIndex === index
    const role = node.kind === 'stage' ? node.role : null
    const state = nodeState({ node, latest, current, passed: currentIndex > index })

    return {
      key: node.key,
      kind: node.kind,
      label: nodeLabel(node.key),
      role,
      binding: role ? (modelBindings[role] ?? null) : null,
      state,
      reason: nodeReason(state, runs),
      current,
      runs,
      latest,
    }
  })
}

/**
 * What the client can honestly say about a stop. The attempt cap is an
 * orchestrator setting the client never sees, so a capped node is described by
 * what it did — failed, this many times — rather than by the bound it hit.
 */
function nodeReason(state: NodeState, runs: readonly Stage[]): string | null {
  if (state === 'skipped') return runs.at(-1)?.skipReason ?? 'skipped'
  if (state !== 'stopped') return null

  const latest = runs.at(-1)
  if (!latest) return null

  if (latest.status === 'interrupted') {
    return latest.interruptionCleanupStatus === 'failed' ? 'stopped · cleanup failed' : 'stopped'
  }

  const attempts = runs.filter((run) => run.status === 'failed').length

  return attempts > 1 ? `failed ${attempts} times` : 'failed'
}

function nodeState(input: {
  node: PinnedNode
  latest: Stage | null
  current: boolean
  passed: boolean
}): NodeState {
  const { node, latest, current, passed } = input

  if (node.kind === 'stage') {
    if (latest) return STAGE_STATE[latest.status] ?? 'pending'

    return current ? 'running' : passed ? 'done' : 'pending'
  }

  // A gate the task sits at is the one thing on this screen waiting on a
  // person; behind the current node it has already been passed through.
  if (current) return node.kind === 'gate' ? 'awaiting' : 'running'

  return passed ? 'done' : 'pending'
}

/** `claude-haiku-4-5-20251001` is a release id, not a name the owner reads at a glance. */
export function shortModel(model: string): string {
  return model.replace(/^claude-/, '').replace(/-\d{8}$/, '')
}

/**
 * What the node has cost so far, over every attempt at it rather than the last
 * one. A stage that failed twice before it held spent three runs' worth of
 * tokens, and the number the owner is checking against the budget is the sum.
 */
export interface NodeSpend {
  readonly attempts: number
  /** Null until an attempt has started; counts up while one is running. */
  readonly durationMs: number | null
  /** The CLI's own usage keys, added across attempts. Null when none reported any. */
  readonly tokens: Readonly<Record<string, number>> | null
  readonly tokenTotal: number | null
  readonly costUsd: number | null
  /** What actually answered, which is not always what the role is bound to. */
  readonly model: string | null
}

export function nodeSpend(node: PipelineNodeView, now = Date.now()): NodeSpend {
  const tokens: Record<string, number> = {}
  let durationMs: number | null = null
  let costUsd: number | null = null

  for (const run of node.runs) {
    const elapsed = stageDuration(run, now)
    if (elapsed !== null) durationMs = (durationMs ?? 0) + elapsed

    const cost = run.telemetry?.costUsd
    if (typeof cost === 'number') costUsd = (costUsd ?? 0) + cost

    for (const [key, value] of Object.entries(run.telemetry?.tokens ?? {})) {
      tokens[key] = (tokens[key] ?? 0) + value
    }
  }

  const counted = Object.values(tokens)

  return {
    attempts: node.runs.length,
    durationMs,
    tokens: counted.length > 0 ? tokens : null,
    tokenTotal: counted.length > 0 ? counted.reduce((total, value) => total + value, 0) : null,
    costUsd,
    model: node.latest?.telemetry?.model ?? node.binding?.model ?? null,
  }
}
