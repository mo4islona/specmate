import type { ReviewFinding, ReviewVerdict } from './result.ts'
import { type AgentRole, type ProviderId, pickReviewProvider, ROLE_CONTRACTS } from './roles.ts'
import { type Caps, isTerminal, TASK_STATES, type TaskState } from './state.ts'

/**
 * Pipelines are data: a task type maps to a declarative definition, one generic
 * engine walks whatever the definition says. Adding a kind of work is a catalog
 * entry (plus a status-enum migration for its node keys), never an engine edit.
 */

export const TASK_TYPES = ['feature', 'bugfix'] as const
export type TaskType = (typeof TASK_TYPES)[number]

export const LOOP_KINDS = ['spec', 'impl'] as const
export type LoopKind = (typeof LOOP_KINDS)[number]

/** Which cap in `Caps` bounds each loop identity. */
export const LOOP_CAPS = {
  spec: 'max_spec_iterations',
  impl: 'max_impl_iterations',
} as const satisfies Record<LoopKind, keyof Caps>

/**
 * How a stage picks its provider: the role's default, or the cross-provider
 * review rule — never the provider that produced the artifacts under review.
 */
export type ProviderBinding = 'role_default' | 'cross_review'

export interface LoopEdge {
  /** Loop edges point strictly backwards; validation rejects anything else. */
  readonly target: TaskState
  readonly loop: LoopKind
}

export interface StageNode {
  readonly kind: 'stage'
  /** Node keys are task-status values: the pinned graph names which of the enum's values a task visits. */
  readonly key: TaskState
  readonly role: AgentRole
  readonly binding: ProviderBinding
  readonly loopEdge?: LoopEdge
}

export interface GateRedirect {
  readonly target: TaskState
  /** The cap identity bounding regenerations through this edge. */
  readonly cap: keyof Caps
}

export interface GateNode {
  readonly kind: 'gate'
  readonly key: TaskState
  readonly approve: TaskState
  readonly redirect?: GateRedirect
  /** Rework re-enters one of these with fresh round counters. */
  readonly rework?: readonly TaskState[]
}

export type PipelineNode = StageNode | GateNode

export interface PipelineDefinition {
  readonly id: string
  /** Ordered: a stage's forward edge is the next node; the last node's is the terminal. */
  readonly nodes: readonly PipelineNode[]
  readonly terminal: TaskState
}

/** The copy pinned into `run_graphs.dag` — the only shape the engine consults. */
export interface PinnedGraph {
  readonly pipeline: string
  readonly entry: TaskState
  readonly terminal: TaskState
  readonly nodes: readonly PipelineNode[]
}

// ─── validation ───────────────────────────────────────────────────────────────

/** Statuses a pipeline node may never claim: the engine owns them for every pipeline. */
const RESERVED_STATES: readonly TaskState[] = [
  'draft',
  'waiting_human',
  'paused',
  'blocked',
  'archived',
  'cancelled',
  'failed',
]

export class PipelineDefinitionError extends Error {
  constructor(readonly defects: readonly string[]) {
    super(`invalid pipeline definition(s):\n${defects.map((d) => `  - ${d}`).join('\n')}`)
    this.name = 'PipelineDefinitionError'
  }
}

/** Every defect names the definition and the offending element. */
export function validateDefinition(def: PipelineDefinition): string[] {
  const defects: string[] = []
  const at = (element: string, problem: string) => {
    defects.push(`${def.id}: ${element}: ${problem}`)
  }

  if (def.nodes.length === 0) {
    at('nodes', 'a definition needs at least one node')

    return defects
  }

  const statuses = new Set<string>(TASK_STATES)
  const index = new Map<TaskState, number>()
  for (const [i, node] of def.nodes.entries()) {
    if (index.has(node.key)) at(`node ${node.key}`, 'duplicate node key')
    index.set(node.key, i)
    if (!statuses.has(node.key)) {
      at(`node ${node.key}`, 'key is not a legal task status value — a migration-shaped gap')
    } else if (RESERVED_STATES.includes(node.key)) {
      at(`node ${node.key}`, 'key is a reserved engine status')
    }
    if (node.kind === 'stage' && !(node.role in ROLE_CONTRACTS)) {
      at(`node ${node.key}`, `role "${node.role}" is not in the role catalog`)
    }
  }

  if (!isTerminal(def.terminal) || def.terminal === 'failed') {
    at(`terminal ${def.terminal}`, 'the terminal must be a terminal task status')
  }

  const resolvable = (target: TaskState) => index.has(target) || target === def.terminal
  for (const node of def.nodes) {
    if (node.kind === 'stage') {
      if (!node.loopEdge) continue
      const { target, loop } = node.loopEdge
      const to = index.get(target)
      const from = index.get(node.key)
      if (to === undefined) {
        at(`loop edge ${node.key} → ${target}`, 'targets a node the definition does not contain')
      } else if (from !== undefined && to >= from) {
        at(`loop edge ${node.key} → ${target}`, 'points forward; loop edges go strictly backwards')
      }
      if (!LOOP_KINDS.includes(loop)) {
        at(`loop edge ${node.key} → ${target}`, `unknown loop identity "${loop}"`)
      }
      continue
    }

    if (!resolvable(node.approve)) {
      at(
        `gate ${node.key}`,
        `approve resolves to "${node.approve}", which the definition does not contain`,
      )
    }
    if (node.redirect && !index.has(node.redirect.target)) {
      at(
        `gate ${node.key}`,
        `redirect resolves to "${node.redirect.target}", which the definition does not contain`,
      )
    }
    for (const target of node.rework ?? []) {
      if (!index.has(target)) {
        at(
          `gate ${node.key}`,
          `rework resolves to "${target}", which the definition does not contain`,
        )
      }
    }
  }
  if (defects.length > 0) return defects

  // Reachability over every edge the engine can follow; the terminal must be
  // reachable from each node or a task could walk itself into a dead end.
  for (const node of def.nodes) {
    if (!reachesTerminal(def, node.key)) {
      at(`node ${node.key}`, 'the terminal is not reachable from this node')
    }
  }

  return defects
}

function reachesTerminal(def: PipelineDefinition, from: TaskState): boolean {
  const seen = new Set<TaskState>()
  const queue: TaskState[] = [from]
  while (queue.length > 0) {
    const key = queue.pop()
    if (key === undefined || seen.has(key)) continue
    if (key === def.terminal) return true

    seen.add(key)
    const i = def.nodes.findIndex((node) => node.key === key)
    if (i === -1) continue
    const node = def.nodes[i]
    if (!node) continue
    if (node.kind === 'stage') {
      queue.push(def.nodes[i + 1]?.key ?? def.terminal)
      if (node.loopEdge) queue.push(node.loopEdge.target)
    } else {
      queue.push(node.approve)
      if (node.redirect) queue.push(node.redirect.target)
      queue.push(...(node.rework ?? []))
    }
  }

  return false
}

/**
 * Validates at load so a broken pipeline is a failed deploy, not a stuck task.
 * The shipped catalog goes through this at module import.
 */
export function loadPipelineCatalog<K extends string>(
  catalog: Readonly<Record<K, PipelineDefinition>>,
): Readonly<Record<K, PipelineDefinition>> {
  const defects = Object.values<PipelineDefinition>(catalog).flatMap(validateDefinition)
  if (defects.length > 0) throw new PipelineDefinitionError(defects)

  return Object.freeze({ ...catalog })
}

// ─── the feature/bugfix definition ────────────────────────────────────────────

/**
 * The lifecycle spec as data. The publish node joins in Phase 6, so the final
 * gate's approval archives directly; the planning segment is declared but fails
 * loudly until the kickoff-brief change ships the planner prompt.
 */
export const FEATURE_BUGFIX_PIPELINE: PipelineDefinition = {
  id: 'feature-bugfix',
  terminal: 'archived',
  nodes: [
    { kind: 'stage', key: 'planning', role: 'planner', binding: 'role_default' },
    { kind: 'stage', key: 'kickoff_brief', role: 'planner', binding: 'role_default' },
    {
      kind: 'gate',
      key: 'human_kickoff_gate',
      approve: 'research',
      redirect: { target: 'planning', cap: 'max_kickoff_regenerations' },
    },
    { kind: 'stage', key: 'research', role: 'researcher', binding: 'role_default' },
    {
      kind: 'stage',
      key: 'spec_review',
      role: 'reviewer',
      binding: 'cross_review',
      loopEdge: { target: 'research', loop: 'spec' },
    },
    { kind: 'gate', key: 'human_spec_gate', approve: 'implement', rework: ['research'] },
    { kind: 'stage', key: 'implement', role: 'implementer', binding: 'role_default' },
    {
      kind: 'stage',
      key: 'verify',
      role: 'verifier',
      binding: 'role_default',
      loopEdge: { target: 'implement', loop: 'impl' },
    },
    {
      kind: 'stage',
      key: 'code_review',
      role: 'reviewer',
      binding: 'cross_review',
      loopEdge: { target: 'implement', loop: 'impl' },
    },
    { kind: 'stage', key: 'summarize', role: 'summarizer', binding: 'role_default' },
    {
      kind: 'gate',
      key: 'human_final_gate',
      approve: 'archived',
      rework: ['implement', 'research'],
    },
  ],
}

export const PIPELINE_CATALOG: Readonly<Record<TaskType, PipelineDefinition>> = loadPipelineCatalog(
  {
    feature: FEATURE_BUGFIX_PIPELINE,
    bugfix: FEATURE_BUGFIX_PIPELINE,
  },
)

// ─── instantiation ────────────────────────────────────────────────────────────

/**
 * The pinned copy contains exactly the definition's nodes and edges; per-task
 * variation lives on the task row (caps, budgets, provider bindings), never in
 * the graph. A catalog changed by a deploy cannot reshape a task in flight.
 */
export function instantiateDefinition(def: PipelineDefinition): PinnedGraph {
  const entry = def.nodes[0]
  if (!entry) {
    throw new PipelineDefinitionError([`${def.id}: nodes: cannot instantiate an empty definition`])
  }

  return structuredClone({
    pipeline: def.id,
    entry: entry.key,
    terminal: def.terminal,
    nodes: def.nodes,
  }) as PinnedGraph
}

// ─── graph accessors ──────────────────────────────────────────────────────────

export function nodeAt(graph: PinnedGraph, key: TaskState): PipelineNode | undefined {
  return graph.nodes.find((node) => node.key === key)
}

export function stageNodeKeys(graph: PinnedGraph): TaskState[] {
  return graph.nodes.filter((node) => node.kind === 'stage').map((node) => node.key)
}

/** The next node in walking order, or the terminal after the last one. */
export function forwardTarget(graph: PinnedGraph, key: TaskState): TaskState {
  const i = graph.nodes.findIndex((node) => node.key === key)
  if (i === -1) throw new Error(`node ${key} is not in pipeline ${graph.pipeline}`)

  return graph.nodes[i + 1]?.key ?? graph.terminal
}

// ─── derived transitions ──────────────────────────────────────────────────────

/**
 * The legal-transition table, derived from a pinned graph instead of written by
 * hand. Interrupt rows stay empty here: entering `waiting_human`/`paused` is a
 * generic rule in `canTransition`, and leaving them returns to the stored
 * resume state, which a static table cannot name.
 */
export function graphTransitions(graph: PinnedGraph): Record<TaskState, readonly TaskState[]> {
  const table = Object.fromEntries(
    TASK_STATES.map((state) => [state, [] as TaskState[]]),
  ) as Record<TaskState, TaskState[]>

  table.draft = [graph.entry, 'cancelled']
  table.blocked = [graph.entry, 'cancelled']
  // Failure is recoverable: a restart may re-enter any stage of the pinned graph.
  table.failed = [...stageNodeKeys(graph), 'cancelled']

  for (const node of graph.nodes) {
    if (node.kind === 'stage') {
      const targets: TaskState[] = [forwardTarget(graph, node.key)]
      if (node.loopEdge) targets.push(node.loopEdge.target)
      targets.push('failed')
      table[node.key] = dedupe(targets)
      continue
    }

    const targets: TaskState[] = [node.approve]
    if (node.redirect) targets.push(node.redirect.target)
    targets.push(...(node.rework ?? []))
    targets.push('cancelled')
    table[node.key] = dedupe(targets)
  }

  return table
}

function dedupe(states: readonly TaskState[]): TaskState[] {
  return [...new Set(states)]
}

/**
 * Legal moves are the pinned graph's edges plus the type-independent interrupt
 * rules. State is changed only by the orchestrator; this is the check it runs.
 */
export function canTransition(graph: PinnedGraph, from: TaskState, to: TaskState): boolean {
  // Interrupts return to the state they interrupted; the exact target lives on
  // the task (`resume_status`), so any graph node is admissible here. Anything
  // else falls through to the generic rules — a parked task can be cancelled.
  if ((from === 'waiting_human' || from === 'paused') && nodeAt(graph, to) !== undefined) {
    return true
  }

  const listed = graphTransitions(graph)[from] ?? []
  if (listed.includes(to)) return true

  // Entering an interrupt is a generic rule, not a graph edge: any non-terminal
  // state can be parked, paused, or cancelled.
  const entersInterrupt = to === 'waiting_human' || to === 'paused' || to === 'cancelled'

  return entersInterrupt && !isTerminal(from)
}

// ─── provider binding ─────────────────────────────────────────────────────────

/**
 * The role's default when it is available, the first configured provider when
 * it is not — and for review stages, never the writer while an alternative
 * exists (`pickReviewProvider` falls back to the writer when it is the only
 * provider configured).
 */
export function bindStageProvider(
  node: StageNode,
  writer: ProviderId | undefined,
  available: readonly ProviderId[],
): ProviderId {
  const preferred = ROLE_CONTRACTS[node.role].defaultProvider
  const base = available.includes(preferred) ? preferred : (available[0] ?? preferred)
  if (node.binding !== 'cross_review' || !writer) return base

  return pickReviewProvider(writer, available)
}

// ─── advancing ────────────────────────────────────────────────────────────────

export interface StageOutcomeSummary {
  readonly status: 'ok' | 'needs_decision'
  readonly verdict?: ReviewVerdict
  readonly findings?: readonly ReviewFinding[]
}

export interface RecordedRound {
  readonly loop: LoopKind
  readonly round: number
  readonly verdict: ReviewVerdict
  /**
   * Rounds recorded before a rework re-entry keep their numbers but stop
   * counting against the cap — rework starts fresh counters.
   */
  readonly counted?: boolean
}

export interface RoundToRecord {
  readonly loop: LoopKind
  readonly round: number
  readonly verdict: ReviewVerdict
  readonly findings: readonly ReviewFinding[]
}

export type ParkCause = 'escalate' | 'cap_exhausted' | 'needs_decision'

export type AdvanceDecision =
  | { readonly kind: 'advance'; readonly to: TaskState; readonly record?: RoundToRecord }
  | { readonly kind: 'loop'; readonly to: TaskState; readonly record: RoundToRecord }
  | {
      readonly kind: 'park'
      readonly reason: ParkCause
      readonly resume: TaskState
      readonly record?: RoundToRecord
    }

/**
 * Pure by construction: pinned graph, node, outcome, stored rounds and caps in;
 * one transition out. The engine around it does only I/O. Nothing here may
 * branch on task type, role, or node identity beyond what the graph declares.
 */
export function advance(
  graph: PinnedGraph,
  nodeKey: TaskState,
  outcome: StageOutcomeSummary,
  rounds: readonly RecordedRound[],
  caps: Caps,
): AdvanceDecision {
  const node = nodeAt(graph, nodeKey)
  if (node?.kind !== 'stage') {
    throw new Error(`cannot advance from ${nodeKey}: it is not a stage node of ${graph.pipeline}`)
  }

  if (outcome.status === 'needs_decision') {
    return { kind: 'park', reason: 'needs_decision', resume: nodeKey }
  }

  const edge = node.loopEdge
  if (!edge) return { kind: 'advance', to: forwardTarget(graph, nodeKey) }

  // Silence is not approval: a loop-edged stage that returns no verdict is a
  // defective outcome the caller must fail, never a pass.
  if (!outcome.verdict) {
    throw new Error(
      `stage ${nodeKey} of ${graph.pipeline} has a loop edge but its outcome carries no verdict`,
    )
  }

  const loopRounds = rounds.filter((round) => round.loop === edge.loop)
  const record: RoundToRecord = {
    loop: edge.loop,
    round: Math.max(0, ...loopRounds.map((round) => round.round)) + 1,
    verdict: outcome.verdict,
    findings: outcome.findings ?? [],
  }

  if (outcome.verdict === 'approve') {
    return { kind: 'advance', to: forwardTarget(graph, nodeKey), record }
  }
  if (outcome.verdict === 'escalate') {
    return { kind: 'park', reason: 'escalate', resume: nodeKey, record }
  }

  const used = loopRounds.filter((r) => r.counted !== false && r.verdict === 'revise').length
  if (used < caps[LOOP_CAPS[edge.loop]]) return { kind: 'loop', to: edge.target, record }

  return { kind: 'park', reason: 'cap_exhausted', resume: nodeKey, record }
}
