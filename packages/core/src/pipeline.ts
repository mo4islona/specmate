import type { PlanSize } from './plan.ts'
import type { ReviewFinding, ReviewVerdict } from './result.ts'
import {
  PIPELINE_ROLES,
  type PipelineRole,
  type ProviderId,
  pickReviewProvider,
  ROLE_CONTRACTS,
} from './roles.ts'
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
  readonly role: PipelineRole
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

/** An orchestrator-owned operation. It has neither an agent role nor a human edge. */
export interface ActionNode {
  readonly kind: 'action'
  readonly key: TaskState
}

export type PipelineNode = StageNode | GateNode | ActionNode

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

/**
 * Statuses a pipeline node may never claim: the engine owns them for every
 * pipeline. Also the poll's exclusion list (`engine.ts`'s NOT_RUNNABLE) — one
 * list, so a new interrupt or terminal state can't drift between the two.
 */
export const RESERVED_STATES: readonly TaskState[] = [
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
    } else if (node.kind === 'stage' && !PIPELINE_ROLES.some((role) => role === node.role)) {
      at(`node ${node.key}`, `role "${node.role}" is not a pipeline role`)
    }
    // The cross-provider rule reads the writer off the loop edge's target; a
    // cross_review stage without one would silently fall back to the default
    // provider instead of ever excluding the writer.
    if (node.kind === 'stage' && node.binding === 'cross_review' && !node.loopEdge) {
      at(
        `node ${node.key}`,
        'binding "cross_review" requires a loopEdge to know whose work to exclude',
      )
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
    if (node.kind === 'action') continue

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
    } else if (node.kind === 'gate') {
      queue.push(node.approve)
      if (node.redirect) queue.push(node.redirect.target)
      queue.push(...(node.rework ?? []))
    } else {
      queue.push(def.nodes[i + 1]?.key ?? def.terminal)
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
 * The lifecycle spec as data. The planning segment is declared but fails loudly
 * until the kickoff-brief change ships the planner prompt.
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
      approve: 'publish',
      rework: ['implement', 'research'],
    },
    { kind: 'action', key: 'publish' },
  ],
}

export const PIPELINE_CATALOG: Readonly<Record<TaskType, PipelineDefinition>> = loadPipelineCatalog(
  {
    feature: FEATURE_BUGFIX_PIPELINE,
    bugfix: FEATURE_BUGFIX_PIPELINE,
  },
)

// ─── profiles ─────────────────────────────────────────────────────────────────

/**
 * How much process a task gets. `full` is the base definition; every other
 * profile is a validated reduction of it (REQ-407). The planner's declared
 * size picks one — the engine bounds the choice, it does not make it.
 */
export const PIPELINE_PROFILES = ['full', 'compact'] as const
export type PipelineProfile = (typeof PIPELINE_PROFILES)[number]

export const PROFILE_FOR_SIZE: Readonly<Record<PlanSize, PipelineProfile>> = {
  small: 'compact',
  medium: 'full',
  large: 'full',
}

/**
 * `kickoff_brief` is the planner running a second time over the file it just
 * wrote — and planning's own output is already checked against every part the
 * brief requires. `spec_review` is a cross-provider review of a spec that, at
 * this size, is a handful of scenarios. Both human gates around them survive.
 */
const COMPACT_DROPS: readonly TaskState[] = ['kickoff_brief', 'spec_review']

/** Derived from the base rather than written out, so the subsequence property cannot drift. */
export const FEATURE_BUGFIX_COMPACT: PipelineDefinition = {
  ...FEATURE_BUGFIX_PIPELINE,
  id: 'feature-bugfix-compact',
  nodes: FEATURE_BUGFIX_PIPELINE.nodes.filter((node) => !COMPACT_DROPS.includes(node.key)),
}

/**
 * A reduction keeps a subsequence of its base's nodes, unchanged and in order,
 * and may not strand an edge. Structural defects are `validateDefinition`'s
 * job; this reports what only a reduction can get wrong, so the message says
 * "dropped by this profile" rather than "not contained".
 */
export function validateReduction(
  base: PipelineDefinition,
  reduction: PipelineDefinition,
): string[] {
  const defects: string[] = []
  const at = (element: string, problem: string) => {
    defects.push(`${reduction.id}: ${element}: ${problem}`)
  }

  if (reduction.terminal !== base.terminal) {
    at(`terminal ${reduction.terminal}`, `differs from ${base.id}'s terminal ${base.terminal}`)
  }

  const kept = new Set(reduction.nodes.map((node) => node.key))
  const dropped = base.nodes.filter((node) => !kept.has(node.key)).map((node) => node.key)

  let cursor = 0
  for (const node of reduction.nodes) {
    const found = base.nodes.findIndex((candidate, i) => i >= cursor && candidate.key === node.key)
    if (found === -1) {
      at(`node ${node.key}`, `is not a node of ${base.id} at or after this position`)
      continue
    }

    if (JSON.stringify(base.nodes[found]) !== JSON.stringify(node)) {
      at(`node ${node.key}`, `differs from ${base.id}'s node of the same key`)
    }
    cursor = found + 1
  }

  const strands = (target: TaskState) => dropped.includes(target)
  for (const node of reduction.nodes) {
    if (node.kind === 'stage') {
      if (node.loopEdge && strands(node.loopEdge.target)) {
        at(`loop edge ${node.key} → ${node.loopEdge.target}`, 'targets a node this profile drops')
      }
      continue
    }
    if (node.kind === 'action') continue

    if (strands(node.approve)) {
      at(`gate ${node.key}`, `approve targets "${node.approve}", which this profile drops`)
    }
    if (node.redirect && strands(node.redirect.target)) {
      at(`gate ${node.key}`, `redirect targets "${node.redirect.target}", which this profile drops`)
    }
    for (const target of node.rework ?? []) {
      if (strands(target)) {
        at(`gate ${node.key}`, `rework targets "${target}", which this profile drops`)
      }
    }
  }

  return defects
}

/**
 * Every profile is validated as a definition, and every reduction against its
 * base — at module import, so a profile that breaks its own graph is a failed
 * deploy rather than a task stuck between two nodes.
 */
export function loadPipelineProfiles<K extends string>(
  catalog: Readonly<Record<K, Readonly<Record<PipelineProfile, PipelineDefinition>>>>,
): Readonly<Record<K, Readonly<Record<PipelineProfile, PipelineDefinition>>>> {
  const defects: string[] = []
  for (const profiles of Object.values<Readonly<Record<PipelineProfile, PipelineDefinition>>>(
    catalog,
  )) {
    for (const profile of PIPELINE_PROFILES) {
      const definition = profiles[profile]
      const structural = validateDefinition(definition)
      defects.push(...structural)
      // A definition that is already broken structurally would report the same
      // stranded edge twice; the reduction check only speaks once it is sound.
      if (structural.length === 0 && profile !== 'full') {
        defects.push(...validateReduction(profiles.full, definition))
      }
    }
  }
  if (defects.length > 0) throw new PipelineDefinitionError(defects)

  return Object.freeze({ ...catalog })
}

export const PIPELINE_PROFILE_CATALOG: Readonly<
  Record<TaskType, Readonly<Record<PipelineProfile, PipelineDefinition>>>
> = loadPipelineProfiles({
  feature: { full: FEATURE_BUGFIX_PIPELINE, compact: FEATURE_BUGFIX_COMPACT },
  bugfix: { full: FEATURE_BUGFIX_PIPELINE, compact: FEATURE_BUGFIX_COMPACT },
})

export function definitionFor(type: TaskType, profile: PipelineProfile): PipelineDefinition {
  return PIPELINE_PROFILE_CATALOG[type][profile]
}

/** The definition a declared size selects — what the engine compares a task's pinned graph against. */
export function definitionForSize(type: TaskType, size: PlanSize): PipelineDefinition {
  return definitionFor(type, PROFILE_FOR_SIZE[size])
}

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
    if (node.kind === 'action') {
      table[node.key] = [forwardTarget(graph, node.key), 'failed', 'cancelled']
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
 * A restart may re-enter the node that failed or any stage strictly earlier
 * in the pinned graph's walking order — never a stage the task has not yet
 * earned its way to. `canTransition` stays permissive about *that* a restart
 * may target any stage; this is the "earlier stage" business rule the old
 * hand-written transition table used to carry.
 */
export function isRestartable(graph: PinnedGraph, target: TaskState, failedAt: TaskState): boolean {
  const order = stageNodeKeys(graph)
  const targetIndex = order.indexOf(target)
  const failedIndex = order.indexOf(failedAt)

  return targetIndex !== -1 && failedIndex !== -1 && targetIndex <= failedIndex
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
  // state can be parked, paused, blocked on another task, or cancelled.
  const entersInterrupt =
    to === 'waiting_human' || to === 'paused' || to === 'blocked' || to === 'cancelled'

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
  /**
   * A requested decision came back marked blocking even though the stage
   * otherwise called itself `ok`. Blocking means blocking regardless of the
   * status it rode in on — an unresolved one left behind by an `ok` stage is
   * still a reason the run cannot honestly keep going.
   */
  readonly hasBlockingDecision?: boolean
}

export interface RecordedRound {
  readonly loop: LoopKind
  readonly round: number
  readonly verdict: ReviewVerdict
  /** Absent for rounds recorded before this store learned to carry findings. */
  readonly findings?: readonly ReviewFinding[]
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

export type ParkCause = 'escalate' | 'repeated_finding' | 'cap_exhausted' | 'needs_decision'

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

  const edge = node.loopEdge

  // Silence is not approval: a loop-edged stage that returns no verdict is a
  // defective outcome the caller must fail — unless a blocking decision
  // already explains why the round stopped short of one.
  if (edge && !outcome.verdict && !outcome.hasBlockingDecision) {
    throw new Error(
      `stage ${nodeKey} of ${graph.pipeline} has a loop edge but its outcome carries no verdict`,
    )
  }

  const loopRounds = edge ? rounds.filter((round) => round.loop === edge.loop) : []
  const record: RoundToRecord | undefined =
    edge && outcome.verdict
      ? {
          loop: edge.loop,
          round: Math.max(0, ...loopRounds.map((round) => round.round)) + 1,
          verdict: outcome.verdict,
          findings: outcome.findings ?? [],
        }
      : undefined

  // Blocking means blocking regardless of what else the outcome carries — a
  // question the owner must answer parks the task even mid-verdict, but the
  // round it interrupted is still evidence and stays on the record.
  if (outcome.hasBlockingDecision) {
    return { kind: 'park', reason: 'needs_decision', resume: nodeKey, ...(record && { record }) }
  }

  if (!edge) return { kind: 'advance', to: forwardTarget(graph, nodeKey) }
  if (!record) {
    throw new Error(
      `stage ${nodeKey} of ${graph.pipeline}: invariant violated, verdict guaranteed present past the earlier guard`,
    )
  }

  if (outcome.verdict === 'approve') {
    return { kind: 'advance', to: forwardTarget(graph, nodeKey), record }
  }
  if (outcome.verdict === 'escalate') {
    return { kind: 'park', reason: 'escalate', resume: nodeKey, record }
  }

  // REQ-607: the same finding id surviving `repeated_finding_threshold`
  // consecutive counted rounds means the loop is not converging — escalate
  // instead of spending another round on it.
  const countedRounds = loopRounds.filter((r) => r.counted !== false)
  const stalled = (outcome.findings ?? []).some(
    (finding) => repeatedRoundStreak(finding.id, countedRounds) >= caps.repeated_finding_threshold,
  )
  if (stalled) {
    return { kind: 'park', reason: 'repeated_finding', resume: nodeKey, record }
  }

  const used = countedRounds.filter((r) => r.verdict === 'revise').length
  if (used < caps[LOOP_CAPS[edge.loop]]) return { kind: 'loop', to: edge.target, record }

  return { kind: 'park', reason: 'cap_exhausted', resume: nodeKey, record }
}

/** How many trailing counted rounds (most recent first), plus the current one, carried this finding id. */
function repeatedRoundStreak(id: string, trailingRounds: readonly RecordedRound[]): number {
  let streak = 1
  for (let i = trailingRounds.length - 1; i >= 0; i--) {
    if (!(trailingRounds[i]?.findings ?? []).some((finding) => finding.id === id)) break

    streak += 1
  }

  return streak
}

/**
 * Evidence for `escalationForPark`'s `repeated_finding` cause: every finding id
 * in the about-to-be-recorded round whose streak meets the threshold, with the
 * round numbers it appeared in (most recent first). Mirrors `repeatedRoundStreak`'s
 * walk exactly, so this never disagrees with `advance()`'s own stalled check.
 */
export function stalledFindings(
  record: RoundToRecord,
  countedRounds: readonly RecordedRound[],
  threshold: number,
): { readonly id: string; readonly rounds: readonly number[] }[] {
  const stalled: { id: string; rounds: number[] }[] = []
  for (const finding of record.findings) {
    const rounds = [record.round]
    for (let i = countedRounds.length - 1; i >= 0; i--) {
      const round = countedRounds[i]
      if (!round?.findings?.some((f) => f.id === finding.id)) break

      rounds.push(round.round)
    }
    if (rounds.length >= threshold) stalled.push({ id: finding.id, rounds })
  }

  return stalled
}
