import { isTerminal, type ModelBinding, type TaskState } from '@specmate/core'
import type { TaskDetail } from './api-client.ts'
import { nodeLabel } from './task-thread.ts'

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
export type NodeState = 'done' | 'running' | 'stopped' | 'awaiting' | 'pending'

export interface PipelineNodeView {
  readonly key: string
  readonly kind: PinnedNode['kind']
  readonly label: string
  readonly role: string | null
  readonly binding: ModelBinding | null
  readonly state: NodeState
  /** Why it stopped, in the slot a finished node states its duration in. */
  readonly stoppedReason: string | null
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
  skipped: 'done',
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
      stoppedReason: state === 'stopped' ? stoppedReason(runs) : null,
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
function stoppedReason(runs: readonly Stage[]): string | null {
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

/**
 * Folds the per-role model table into the pipeline: one baseline for the whole
 * run, and a value on the individual node only where it departs from it. A
 * task left on its defaults says so once instead of nine times; an override is
 * visible exactly where it takes effect.
 */
export function bindingBaseline(nodes: readonly PipelineNodeView[]): ModelBinding | null {
  const counts = new Map<string, { binding: ModelBinding; count: number }>()
  for (const node of nodes) {
    if (!node.binding) continue
    const key = `${node.binding.model}/${node.binding.reasoningEffort}`
    const entry = counts.get(key) ?? { binding: node.binding, count: 0 }
    counts.set(key, { binding: entry.binding, count: entry.count + 1 })
  }

  const ranked = [...counts.values()].sort((left, right) => right.count - left.count)

  return ranked[0]?.binding ?? null
}

export function isBaselineBinding(
  binding: ModelBinding | null,
  baseline: ModelBinding | null,
): boolean {
  if (!binding || !baseline) return true

  return binding.model === baseline.model && binding.reasoningEffort === baseline.reasoningEffort
}

/** `claude-haiku-4-5-20251001` is a release id, not a name the owner reads at a glance. */
export function shortModel(model: string): string {
  return model.replace(/^claude-/, '').replace(/-\d{8}$/, '')
}
