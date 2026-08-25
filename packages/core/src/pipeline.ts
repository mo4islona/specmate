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

/**
 * Facts a predicate may be handed, with what each one is derived from. The kind is
 * what makes REQ-409's circularity check mechanical rather than a review convention:
 * an `outcome` fact is something a stage concluded, and a node guarded by one would be
 * deciding its own necessity from a judgement it exists to produce.
 */
export type NodeFactKind = 'input' | 'outcome'

export const NODE_FACT_KINDS = {
  specScenarioCount: 'input',
  specSuiteInForce: 'input',
  /**
   * Named because it is the tempting one: skipping a check because the last check
   * passed is exactly the circularity REQ-409 forbids. No predicate may read it, so
   * nothing ever assembles it — it exists to give the guard something to catch.
   */
  checkedNodeVerdict: 'outcome',
} as const satisfies Record<string, NodeFactKind>

export type NodeFactKey = keyof typeof NODE_FACT_KINDS

/** Widens the literal so the check reads as a comparison rather than a tautology. */
export function factKind(fact: NodeFactKey): NodeFactKind {
  return NODE_FACT_KINDS[fact]
}

type InputFactKey = {
  [K in NodeFactKey]: (typeof NODE_FACT_KINDS)[K] extends 'input' ? K : never
}[NodeFactKey]

/** What an assembled fact is worth. `Pick` is the tie: a new input fact must land here too. */
type FactValues = {
  specScenarioCount: number
  specSuiteInForce: boolean
}

/**
 * Only input facts are ever assembled: an outcome fact has no legal reader.
 *
 * Partial because assembling one costs different things — the scenario count needs the
 * working tree, the repository's convention needs only the task row. The engine assembles
 * what the node's own predicate declares it reads, so a gate asking about the repository
 * does not pay for a checkout.
 */
export type NodeFacts = Readonly<Partial<Pick<FactValues, InputFactKey>>>

export interface PredicateVerdict {
  readonly holds: boolean
  /** Why the node is being skipped. Empty when it runs — nothing to explain. */
  readonly reason: string
}

export interface PredicateSpec {
  /** Declared rather than inferred: the circularity check reads this, not the body. */
  readonly reads: readonly NodeFactKey[]
  /** Whether the catalog entry must carry a threshold. A flag has nothing to compare against. */
  readonly takesThreshold: boolean
  evaluate(facts: Required<NodeFacts>, threshold: number | undefined): PredicateVerdict
}

/**
 * A predicate says when a node *runs*, never when it is skipped — REQ-409 is phrased
 * that way and inverting it here would put the negation in every reading of a catalog
 * entry.
 */
export const NODE_PREDICATES = {
  spec_scenarios_at_least: {
    reads: ['specScenarioCount'],
    takesThreshold: true,
    evaluate: (facts, threshold) => ({
      holds: facts.specScenarioCount >= (threshold ?? 0),
      reason: `the specification declares ${facts.specScenarioCount} scenario(s), under the ${threshold} this node is worth`,
    }),
  },
  spec_suite_in_force: {
    reads: ['specSuiteInForce'],
    takesThreshold: false,
    evaluate: (facts) => ({
      holds: facts.specSuiteInForce,
      reason: 'the repository has no specification suite for this to land in',
    }),
  },
} as const satisfies Record<string, PredicateSpec>

export type PredicateId = keyof typeof NODE_PREDICATES

export interface NodeCondition {
  readonly predicate: PredicateId
  /** Absent for a predicate that reads a flag; validation holds the two in step. */
  readonly threshold?: number
}

/**
 * A node may carry more than one, and runs only where all of them hold. The single form
 * stays legal because pinned graphs hold it: a task pinned before the second condition
 * existed must keep the guard it was pinned with, not lose it to a shape change.
 */
export type NodeConditions = NodeCondition | readonly NodeCondition[]

export function conditionsOf(node: PipelineNode): readonly NodeCondition[] {
  if (node.kind === 'action' || !node.condition) return []

  // Discriminated on the field rather than on `Array.isArray`, which does not narrow a
  // readonly array out of the union.
  return 'predicate' in node.condition ? [node.condition] : node.condition
}

export interface StageNode {
  readonly kind: 'stage'
  /** Node keys are task-status values: the pinned graph names which of the enum's values a task visits. */
  readonly key: TaskState
  readonly role: PipelineRole
  readonly binding: ProviderBinding
  readonly loopEdge?: LoopEdge
  /** Continues an earlier node's provider session instead of opening one (REQ-410). */
  readonly resumes?: TaskState
  /** Runs only where every predicate holds; skipped with its reason otherwise (REQ-409). */
  readonly condition?: NodeConditions
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
  /**
   * A gate the definition can account for in advance, not a gate the engine may decide
   * to stop asking. A skipped gate advances along `approve` — the edge it takes when
   * nothing is wrong — and records no decision: an approve is an owner's act, and
   * manufacturing one from a repository fact would sign for nobody.
   */
  readonly condition?: NodeConditions
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

/**
 * What only a condition can get wrong. Separate from `validateDefinition` so the rule
 * can be exercised against a predicate the shipped registry would never contain —
 * REQ-409's circularity is unreachable while every registered predicate is well-behaved.
 */
export function conditionDefects(
  condition: NodeCondition,
  spec: PredicateSpec | undefined,
): string[] {
  if (!spec) return [`predicate "${condition.predicate}" is not in the registry`]

  const defects: string[] = []

  // The guard may read what is true when the task arrives, never what the node it
  // guards would go on to conclude.
  const circular = spec.reads.filter((fact) => factKind(fact) === 'outcome')
  if (circular.length > 0) {
    defects.push(
      `predicate "${condition.predicate}" reads stage outcomes (${circular.join(', ')}); a node may not be skipped on the strength of a judgement it exists to produce`,
    )
  }

  const given = condition.threshold !== undefined
  if (given && !spec.takesThreshold) {
    defects.push(`predicate "${condition.predicate}" takes no threshold, and one was given`)
  }
  if (!given && spec.takesThreshold) {
    defects.push(`predicate "${condition.predicate}" needs a threshold, and none was given`)
  }

  return defects
}

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
    for (const condition of conditionsOf(node)) {
      for (const defect of conditionDefects(condition, NODE_PREDICATES[condition.predicate])) {
        at(`node ${node.key}`, defect)
      }
    }
  }

  if (!isTerminal(def.terminal) || def.terminal === 'failed') {
    at(`terminal ${def.terminal}`, 'the terminal must be a terminal task status')
  }

  const resolvable = (target: TaskState) => index.has(target) || target === def.terminal
  for (const node of def.nodes) {
    if (node.kind === 'stage') {
      if (node.resumes) {
        const from = index.get(node.key)
        const to = index.get(node.resumes)
        const resumed = def.nodes.find((candidate) => candidate.key === node.resumes)

        if (to === undefined) {
          at(`node ${node.key}`, `resumes "${node.resumes}", which the definition does not contain`)
        } else if (from !== undefined && to >= from) {
          at(`node ${node.key}`, `resumes "${node.resumes}", which is not strictly earlier`)
        } else if (resumed?.kind !== 'stage') {
          at(`node ${node.key}`, `resumes "${node.resumes}", which is not a stage`)
        } else if (resumed.role !== node.role) {
          at(
            `node ${node.key}`,
            `resumes "${node.resumes}", whose role is "${resumed.role}" and not "${node.role}" — a session does not carry between roles`,
          )
        }
      }
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
/**
 * How small a specification has to be before a cross-provider read of it stops
 * earning its stage. A number in the catalog rather than a rule in code, because the
 * honest way to tune it is against real specs.
 */
export const SPEC_REVIEW_SCENARIO_FLOOR = 4

export const FEATURE_BUGFIX_PIPELINE: PipelineDefinition = {
  id: 'feature-bugfix',
  terminal: 'archived',
  nodes: [
    { kind: 'stage', key: 'planning', role: 'planner', binding: 'role_default' },
    {
      kind: 'gate',
      key: 'human_kickoff_gate',
      approve: 'specify',
      redirect: { target: 'planning', cap: 'max_kickoff_regenerations' },
    },
    // The same planner, continuing the session that read the repository, rather than a
    // second role reading it again and grounding the spec differently from the brief
    // the owner just approved.
    // The whole specification segment is conditional on the repository having somewhere
    // to keep a specification (REQ-1706). It is skipped, never dropped: the three nodes
    // stay on the graph carrying the reason, which is the difference between a decision
    // the owner can read and a shorter graph nobody can account for.
    {
      kind: 'stage',
      key: 'specify',
      role: 'planner',
      binding: 'role_default',
      resumes: 'planning',
      condition: { predicate: 'spec_suite_in_force' },
    },
    {
      kind: 'stage',
      key: 'spec_review',
      role: 'reviewer',
      binding: 'cross_review',
      loopEdge: { target: 'specify', loop: 'spec' },
      // Order is the reason: with no suite there is no specification to count, and the
      // scenario floor would skip this node saying "0 scenario(s)" — true, and silent
      // about why there are none.
      condition: [
        { predicate: 'spec_suite_in_force' },
        { predicate: 'spec_scenarios_at_least', threshold: SPEC_REVIEW_SCENARIO_FLOOR },
      ],
    },
    {
      kind: 'gate',
      key: 'human_spec_gate',
      approve: 'implement',
      rework: ['specify'],
      condition: { predicate: 'spec_suite_in_force' },
    },
    { kind: 'stage', key: 'implement', role: 'implementer', binding: 'role_default' },
    // One node proves and judges. Two would read the same diff twice into the same cap,
    // and would put the cross-provider independence on the half that only asserts.
    {
      kind: 'stage',
      key: 'validate',
      role: 'validator',
      binding: 'cross_review',
      loopEdge: { target: 'implement', loop: 'impl' },
    },
    { kind: 'stage', key: 'summarize', role: 'summarizer', binding: 'role_default' },
    {
      kind: 'gate',
      key: 'human_final_gate',
      approve: 'publish',
      rework: ['implement', 'specify'],
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
 * How much rope a size gets. `medium` and `large` share a profile, so this is the
 * whole of what separates them — REQ-408 forbids two sizes selecting the same profile
 * *under the same caps*, and after the merges `spec_review` is the only droppable node
 * left, everything else being the spine REQ-602 protects.
 *
 * Fields absent here keep the task's own value: an owner who set a cap deliberately is
 * not overruled by a size the planner declared afterwards.
 */
export const CAPS_FOR_SIZE: Readonly<Record<PlanSize, Partial<Caps>>> = {
  small: { max_spec_iterations: 1, max_impl_iterations: 2 },
  medium: { max_spec_iterations: 2, max_impl_iterations: 3 },
  large: { max_spec_iterations: 3, max_impl_iterations: 4 },
}

/**
 * The caps a declared size selects, over the task's current caps, with anything the
 * owner named at creation winning over both.
 */
export function capsForSize(size: PlanSize, current: Caps, override: Partial<Caps>): Caps {
  return { ...current, ...CAPS_FOR_SIZE[size], ...override }
}

/**
 * `spec_review` is a cross-provider review of a spec that, at this size, is a handful
 * of scenarios. Both human gates around it survive.
 */
const COMPACT_DROPS: readonly TaskState[] = ['spec_review']

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
      if (node.resumes && strands(node.resumes)) {
        at(`node ${node.key}`, `resumes "${node.resumes}", which this profile drops`)
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

/**
 * Whether a node runs at all, and why not. An unconditional node always runs, so the
 * engine asks this of every stage rather than branching on whether one is conditional.
 */
export function evaluateCondition(node: PipelineNode, facts: NodeFacts): PredicateVerdict {
  const runs: PredicateVerdict = { holds: true, reason: '' }
  const present = facts as Readonly<Record<string, unknown>>

  for (const condition of conditionsOf(node)) {
    const spec: PredicateSpec | undefined = NODE_PREDICATES[condition.predicate]
    // Unreachable through a loaded catalog: validation rejects an unknown predicate at
    // import. Running the node is the safe reading if one ever gets here.
    if (!spec) continue

    // A fact nobody could assemble is not a reason to skip. Same rule as a fact bundle
    // that could not be built at all: skipping a check needs a reason, running one does not.
    if (spec.reads.some((fact) => present[fact] === undefined)) continue

    const verdict = spec.evaluate(facts as Required<NodeFacts>, condition.threshold)
    if (!verdict.holds) return verdict
  }

  return runs
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
