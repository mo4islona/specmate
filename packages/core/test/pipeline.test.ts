import { describe, expect, it, test } from 'vitest'
import {
  advance,
  bindStageProvider,
  Caps,
  canTransition,
  conditionDefects,
  conditionsOf,
  definitionFor,
  definitionForSize,
  evaluateCondition,
  FEATURE_BUGFIX_COMPACT,
  FEATURE_BUGFIX_PIPELINE,
  factKind,
  forwardTarget,
  type GateNode,
  graphTransitions,
  HUMAN_GATES,
  instantiateDefinition,
  isRestartable,
  loadPipelineCatalog,
  loadPipelineProfiles,
  NODE_FACT_KINDS,
  NODE_PREDICATES,
  PIPELINE_CATALOG,
  PIPELINE_PROFILES,
  type PinnedGraph,
  type PipelineDefinition,
  PipelineDefinitionError,
  type PipelineNode,
  type PredicateId,
  type PredicateSpec,
  type RecordedRound,
  type StageNode,
  TASK_STATES,
  TASK_TYPES,
  type TaskState,
  validateDefinition,
  validateReduction,
} from '../src/index.ts'

const caps = Caps.parse({})
const graph = instantiateDefinition(FEATURE_BUGFIX_PIPELINE)

function def(overrides: Partial<PipelineDefinition>): PipelineDefinition {
  return {
    id: 'fixture',
    terminal: 'archived',
    nodes: [
      { kind: 'stage', key: 'research', role: 'researcher', binding: 'role_default' },
      {
        kind: 'stage',
        key: 'spec_review',
        role: 'reviewer',
        binding: 'cross_review',
        loopEdge: { target: 'research', loop: 'spec' },
      },
    ],
    ...overrides,
  }
}

describe('definition validation', () => {
  test('a well-formed definition has no defects', () => {
    expect(validateDefinition(def({}))).toEqual([])
    expect(validateDefinition(FEATURE_BUGFIX_PIPELINE)).toEqual([])
  })

  test('duplicate node keys are rejected naming the key', () => {
    const broken = def({
      nodes: [
        { kind: 'stage', key: 'research', role: 'researcher', binding: 'role_default' },
        { kind: 'stage', key: 'research', role: 'reviewer', binding: 'role_default' },
      ],
    })

    expect(validateDefinition(broken).join('\n')).toMatch(/fixture.*research.*duplicate/)
  })

  test('a node key outside the task-status set names the migration-shaped gap', () => {
    const broken = def({
      nodes: [
        { kind: 'stage', key: 'triage' as TaskState, role: 'researcher', binding: 'role_default' },
      ],
    })

    expect(validateDefinition(broken).join('\n')).toMatch(/triage.*migration-shaped gap/)
  })

  test('a stage naming an unknown role is rejected naming node and role', () => {
    const broken = def({
      nodes: [
        {
          kind: 'stage',
          key: 'research',
          role: 'chef' as StageNode['role'],
          binding: 'role_default',
        },
      ],
    })

    expect(validateDefinition(broken).join('\n')).toMatch(/research.*"chef".*role catalog/)
  })

  test('cross_review without a loop edge is rejected naming the node', () => {
    const broken = def({
      nodes: [
        { kind: 'stage', key: 'research', role: 'researcher', binding: 'role_default' },
        { kind: 'stage', key: 'spec_review', role: 'reviewer', binding: 'cross_review' },
      ],
    })

    expect(validateDefinition(broken).join('\n')).toMatch(/spec_review.*cross_review.*loopEdge/)
  })

  test('the answer-only role cannot enter a pinned pipeline', () => {
    const broken = def({
      nodes: [
        {
          kind: 'stage',
          key: 'research',
          role: 'answerer' as StageNode['role'],
          binding: 'role_default',
        },
      ],
    })

    expect(validateDefinition(broken)).toContain(
      'fixture: node research: role "answerer" is not a pipeline role',
    )
  })

  test('a forward loop edge is rejected naming the edge', () => {
    const broken = def({
      nodes: [
        {
          kind: 'stage',
          key: 'research',
          role: 'researcher',
          binding: 'role_default',
          loopEdge: { target: 'spec_review', loop: 'spec' },
        },
        { kind: 'stage', key: 'spec_review', role: 'reviewer', binding: 'cross_review' },
      ],
    })

    expect(validateDefinition(broken).join('\n')).toMatch(
      /loop edge research → spec_review.*forward/,
    )
  })

  test('a gate resolution outside the definition is rejected naming the gate', () => {
    const broken = def({
      nodes: [
        { kind: 'stage', key: 'research', role: 'researcher', binding: 'role_default' },
        { kind: 'gate', key: 'human_spec_gate', approve: 'publish' },
      ],
    })

    expect(validateDefinition(broken).join('\n')).toMatch(/human_spec_gate.*"publish"/)
  })

  test('a node from which the terminal is unreachable is rejected', () => {
    const broken = def({
      nodes: [
        { kind: 'stage', key: 'research', role: 'researcher', binding: 'role_default' },
        { kind: 'gate', key: 'human_spec_gate', approve: 'research' },
      ],
    })

    expect(validateDefinition(broken).join('\n')).toMatch(/terminal is not reachable/)
  })

  test('a reserved engine status cannot be a node key', () => {
    const broken = def({
      nodes: [{ kind: 'stage', key: 'waiting_human', role: 'researcher', binding: 'role_default' }],
    })

    expect(validateDefinition(broken).join('\n')).toMatch(/waiting_human.*reserved/)
  })

  test('loading a broken catalog throws with every defect listed', () => {
    expect(() => loadPipelineCatalog({ broken: def({ nodes: [] }) })).toThrow(
      PipelineDefinitionError,
    )
  })

  test('importing a catalog with a forward loop edge throws naming the edge', async () => {
    await expect(import('./fixtures/forward-loop-catalog.ts')).rejects.toThrow(
      /loop edge implement → code_review.*forward/,
    )
  })
})

describe('the feature/bugfix definition', () => {
  test('feature and bugfix share the catalog entry', () => {
    expect(PIPELINE_CATALOG.feature).toBe(FEATURE_BUGFIX_PIPELINE)
    expect(PIPELINE_CATALOG.bugfix).toBe(FEATURE_BUGFIX_PIPELINE)
  })

  test('loop identities and targets match the lifecycle', () => {
    const stages = FEATURE_BUGFUX_STAGES()
    expect(stages.spec_review?.loopEdge).toEqual({ target: 'specify', loop: 'spec' })
    expect(stages.validate?.loopEdge).toEqual({ target: 'implement', loop: 'impl' })
  })

  test('AC-420: exactly one node loops back to implementation', () => {
    const loopers = FEATURE_BUGFIX_PIPELINE.nodes.filter(
      (node) => node.kind === 'stage' && node.loopEdge?.target === 'implement',
    )

    expect(loopers.map((node) => node.key)).toEqual(['validate'])
  })

  test('specification continues planning rather than re-reading the repository', () => {
    const stages = FEATURE_BUGFUX_STAGES()
    expect(stages.specify?.resumes).toBe('planning')
    expect(stages.specify?.role).toBe(stages.planning?.role)
  })

  test('AC-135: no checking node is bound to its role default', () => {
    const checking = FEATURE_BUGFIX_PIPELINE.nodes.filter(
      (node) => node.kind === 'stage' && node.loopEdge,
    )

    expect(checking.length).toBeGreaterThan(0)
    for (const node of checking) {
      expect(node.kind === 'stage' && node.binding).toBe('cross_review')
    }
  })

  test('gate inventory is exactly the mandatory human gates', () => {
    const gates = FEATURE_BUGFIX_PIPELINE.nodes
      .filter((node) => node.kind === 'gate')
      .map((node) => node.key)

    expect(gates).toEqual([...HUMAN_GATES])
  })

  test('the kickoff redirect is bounded by the regeneration cap', () => {
    const kickoff = FEATURE_BUGFIX_PIPELINE.nodes.find((n) => n.key === 'human_kickoff_gate')
    expect(kickoff?.kind === 'gate' && kickoff.redirect).toEqual({
      target: 'planning',
      cap: 'max_kickoff_regenerations',
    })
  })

  test('the final gate routes through publish before archive', () => {
    const final = FEATURE_BUGFIX_PIPELINE.nodes.find((n) => n.key === 'human_final_gate')
    expect(final?.kind === 'gate' && final.approve).toBe('publish')
    const publish = FEATURE_BUGFIX_PIPELINE.nodes.find((n) => n.key === 'publish')
    expect(publish?.kind).toBe('action')
    expect(forwardTarget(graph, 'publish')).toBe('archived')
  })

  function FEATURE_BUGFUX_STAGES() {
    const stages: Partial<Record<TaskState, StageNode>> = {}
    for (const node of FEATURE_BUGFIX_PIPELINE.nodes) {
      if (node.kind === 'stage') stages[node.key] = node
    }

    return stages
  }
})

describe('derived transitions', () => {
  /**
   * The hand-written table from state.ts survives here as the expected
   * rendering of the feature definition. Deliberate deltas from the deleted
   * original: `failed` is reachable from every stage (the attempt cap),
   * `waiting_human` entry is a generic rule rather than a listed edge, the
   * final gate approves into the publish action before the terminal,
   * and a failed task may restart into any stage of its pinned graph.
   */
  const EXPECTED: Record<TaskState, readonly TaskState[]> = {
    draft: ['planning', 'cancelled'],
    planning: ['human_kickoff_gate', 'failed'],
    human_kickoff_gate: ['specify', 'planning', 'cancelled'],
    specify: ['spec_review', 'failed'],
    spec_review: ['human_spec_gate', 'specify', 'failed'],
    human_spec_gate: ['implement', 'specify', 'cancelled'],
    implement: ['validate', 'failed'],
    validate: ['summarize', 'implement', 'failed'],
    summarize: ['human_final_gate', 'failed'],
    human_final_gate: ['publish', 'implement', 'specify', 'cancelled'],
    publish: ['archived', 'failed', 'cancelled'],
    archived: [],
    waiting_human: [],
    paused: [],
    blocked: ['planning', 'cancelled'],
    cancelled: [],
    failed: [
      'planning',
      'specify',
      'spec_review',
      'implement',
      'validate',
      'summarize',
      'cancelled',
    ],
    // Retired node keys. They stay in the status enum for graphs pinned before the
    // pipeline was compressed, and a graph that does not contain them offers no edges.
    kickoff_brief: [],
    research: [],
    verify: [],
    code_review: [],
  }

  test('graph-derived transitions equal the expected rendering for every state', () => {
    expect(graphTransitions(graph)).toEqual(EXPECTED)
  })

  test('every derived target is a known state', () => {
    const known = new Set<string>(TASK_STATES)
    for (const targets of Object.values(graphTransitions(graph))) {
      for (const to of targets) expect(known.has(to)).toBe(true)
    }
  })
})

describe('graph-derived legality', () => {
  test('happy path walks from draft to archived', () => {
    const path: TaskState[] = [
      'draft',
      'planning',
      'human_kickoff_gate',
      'specify',
      'spec_review',
      'human_spec_gate',
      'implement',
      'validate',
      'summarize',
      'human_final_gate',
      'publish',
      'archived',
    ]
    for (let i = 0; i < path.length - 1; i++) {
      const from = path[i]
      const to = path[i + 1]
      if (!from || !to) throw new Error('path is malformed')
      expect(canTransition(graph, from, to), `${from} → ${to}`).toBe(true)
    }
  })

  test('review loops go back, not forward', () => {
    expect(canTransition(graph, 'spec_review', 'specify')).toBe(true)
    expect(canTransition(graph, 'validate', 'implement')).toBe(true)
    expect(canTransition(graph, 'validate', 'summarize')).toBe(true)
    expect(canTransition(graph, 'validate', 'human_final_gate')).toBe(false)
    expect(canTransition(graph, 'validate', 'archived')).toBe(false)
  })

  test('interrupt entry and exit keep working', () => {
    expect(canTransition(graph, 'implement', 'paused')).toBe(true)
    expect(canTransition(graph, 'spec_review', 'waiting_human')).toBe(true)
    expect(canTransition(graph, 'waiting_human', 'spec_review')).toBe(true)
    expect(canTransition(graph, 'paused', 'implement')).toBe(true)
    expect(canTransition(graph, 'waiting_human', 'archived')).toBe(false)
  })

  test('a parked task can still be cancelled or paused', () => {
    expect(canTransition(graph, 'waiting_human', 'cancelled')).toBe(true)
    expect(canTransition(graph, 'paused', 'cancelled')).toBe(true)
    expect(canTransition(graph, 'waiting_human', 'paused')).toBe(true)
  })

  test('terminal states stay terminal, failed stays recoverable', () => {
    expect(canTransition(graph, 'archived', 'cancelled')).toBe(false)
    expect(canTransition(graph, 'archived', 'paused')).toBe(false)
    expect(canTransition(graph, 'cancelled', 'planning')).toBe(false)
    expect(canTransition(graph, 'failed', 'implement')).toBe(true)
    expect(canTransition(graph, 'failed', 'cancelled')).toBe(true)
    expect(canTransition(graph, 'failed', 'paused')).toBe(false)
  })

  test('blocked is enterable from a stage node and from a gate, like any other interrupt', () => {
    expect(canTransition(graph, 'implement', 'blocked')).toBe(true)
    expect(canTransition(graph, 'human_spec_gate', 'blocked')).toBe(true)
    expect(canTransition(graph, 'planning', 'blocked')).toBe(true)
  })

  test('leaving blocked resolves only to the pipeline entry or cancellation', () => {
    expect(canTransition(graph, 'blocked', 'planning')).toBe(true)
    expect(canTransition(graph, 'blocked', 'cancelled')).toBe(true)
    expect(canTransition(graph, 'blocked', 'implement')).toBe(false)
    expect(canTransition(graph, 'blocked', 'specify')).toBe(false)
  })

  test('a terminal task cannot be blocked', () => {
    expect(canTransition(graph, 'archived', 'blocked')).toBe(false)
    expect(canTransition(graph, 'cancelled', 'blocked')).toBe(false)
  })

  test('two tasks with different pipelines each answer to their own graph', () => {
    const other: PinnedGraph = instantiateDefinition(
      def({
        id: 'short',
        nodes: [
          { kind: 'stage', key: 'research', role: 'researcher', binding: 'role_default' },
          { kind: 'gate', key: 'human_final_gate', approve: 'archived' },
        ],
      }),
    )

    expect(canTransition(other, 'research', 'human_final_gate')).toBe(true)
    expect(canTransition(other, 'research', 'spec_review')).toBe(false)
    expect(canTransition(graph, 'specify', 'spec_review')).toBe(true)
  })
})

describe('restart eligibility', () => {
  test('the failed stage itself is always restartable', () => {
    expect(isRestartable(graph, 'implement', 'implement')).toBe(true)
  })

  test('an earlier stage is restartable', () => {
    expect(isRestartable(graph, 'specify', 'implement')).toBe(true)
  })

  test('a later stage is not restartable — it may assume artifacts never produced', () => {
    expect(isRestartable(graph, 'code_review', 'implement')).toBe(false)
  })

  test('a gate is never a restart target', () => {
    expect(isRestartable(graph, 'human_spec_gate', 'implement')).toBe(false)
  })
})

describe('instantiation', () => {
  test('the pinned copy carries exactly the definition nodes and edges', () => {
    expect(graph.pipeline).toBe('feature-bugfix')
    expect(graph.entry).toBe('planning')
    expect(graph.terminal).toBe('archived')
    expect(graph.nodes).toEqual([...FEATURE_BUGFIX_PIPELINE.nodes])
  })

  test('the pinned copy is a deep copy, immune to later catalog edits', () => {
    const pinned = instantiateDefinition(FEATURE_BUGFIX_PIPELINE)
    ;(pinned.nodes as StageNode[])[0] = {
      kind: 'stage',
      key: 'research',
      role: 'retro',
      binding: 'role_default',
    }

    expect(FEATURE_BUGFIX_PIPELINE.nodes[0]?.key).toBe('planning')
  })
})

describe('provider binding', () => {
  const review = graph.nodes.find((n) => n.key === 'validate') as StageNode
  const implement = graph.nodes.find((n) => n.key === 'implement') as StageNode

  test('a review never runs on its writer while an alternative exists', () => {
    expect(bindStageProvider(review, 'claude-code', ['claude-code', 'codex'])).toBe('codex')
  })

  test('a single configured provider reviews its own work', () => {
    expect(bindStageProvider(review, 'claude-code', ['claude-code'])).toBe('claude-code')
  })

  test('a stage without the cross-review rule takes the available role default', () => {
    expect(bindStageProvider(implement, undefined, ['claude-code', 'codex'])).toBe('codex')
    expect(bindStageProvider(implement, undefined, ['claude-code'])).toBe('claude-code')
  })

  // REQ-213: the task's own binding is what a stage runs under; the role
  // catalog's default is what a caller with no task falls back to.
  test("the task's binding is preferred over the role catalog's default", () => {
    expect(bindStageProvider(implement, undefined, ['claude-code', 'codex'], 'claude-code')).toBe(
      'claude-code',
    )
  })

  test('a bound provider this deployment does not run falls back to one it does', () => {
    expect(bindStageProvider(implement, undefined, ['claude-code'], 'codex')).toBe('claude-code')
  })

  test('the cross-review rule outranks the binding, which is the point of it', () => {
    expect(bindStageProvider(review, 'codex', ['claude-code', 'codex'], 'codex')).toBe(
      'claude-code',
    )
  })
})

describe('advance', () => {
  const rounds = (
    ...entries: [RecordedRound['loop'], number, RecordedRound['verdict'], boolean?][]
  ): RecordedRound[] =>
    entries.map(([loop, round, verdict, counted]) => ({ loop, round, verdict, counted }))

  test('plain success advances along the forward edge', () => {
    expect(advance(graph, 'specify', { status: 'ok' }, [], caps)).toEqual({
      kind: 'advance',
      to: 'spec_review',
    })
  })

  test('a loop-edged stage without a verdict is a defect, not an approval', () => {
    expect(() => advance(graph, 'validate', { status: 'ok' }, [], caps)).toThrow(/verdict/)
  })

  test('approve advances and records the round', () => {
    const decision = advance(
      graph,
      'spec_review',
      { status: 'ok', verdict: 'approve' },
      rounds(['spec', 1, 'revise']),
      caps,
    )

    expect(decision).toEqual({
      kind: 'advance',
      to: 'human_spec_gate',
      record: { loop: 'spec', round: 2, verdict: 'approve', findings: [] },
    })
  })

  test('revise within the cap records the round and follows the loop edge', () => {
    const decision = advance(graph, 'spec_review', { status: 'ok', verdict: 'revise' }, [], caps)

    expect(decision).toEqual({
      kind: 'loop',
      to: 'specify',
      record: { loop: 'spec', round: 1, verdict: 'revise', findings: [] },
    })
  })

  test('revise at the cap parks awaiting a human', () => {
    const used = rounds(['spec', 1, 'revise'], ['spec', 2, 'revise'], ['spec', 3, 'revise'])
    const decision = advance(graph, 'spec_review', { status: 'ok', verdict: 'revise' }, used, caps)

    expect(decision).toEqual({
      kind: 'park',
      reason: 'cap_exhausted',
      resume: 'spec_review',
      record: { loop: 'spec', round: 4, verdict: 'revise', findings: [] },
    })
  })

  test('rounds before a rework keep their numbers but stop counting', () => {
    const used = rounds(
      ['spec', 1, 'revise', false],
      ['spec', 2, 'revise', false],
      ['spec', 3, 'revise', false],
    )
    const decision = advance(graph, 'spec_review', { status: 'ok', verdict: 'revise' }, used, caps)

    expect(decision).toEqual({
      kind: 'loop',
      to: 'specify',
      record: { loop: 'spec', round: 4, verdict: 'revise', findings: [] },
    })
  })

  test('the two impl reviewers share one cap', () => {
    const used = rounds(['impl', 1, 'revise'], ['impl', 2, 'approve'], ['impl', 3, 'revise'])
    const decision = advance(graph, 'validate', { status: 'ok', verdict: 'revise' }, used, caps)

    expect(decision).toEqual({
      kind: 'loop',
      to: 'implement',
      record: { loop: 'impl', round: 4, verdict: 'revise', findings: [] },
    })
  })

  test('escalate parks and records the verdict', () => {
    const decision = advance(
      graph,
      'validate',
      {
        status: 'ok',
        verdict: 'escalate',
        findings: [{ id: 'f1', severity: 'blocking', title: 'stuck', detail_md: '' }],
      },
      [],
      caps,
    )

    expect(decision).toEqual({
      kind: 'park',
      reason: 'escalate',
      resume: 'validate',
      record: {
        loop: 'impl',
        round: 1,
        verdict: 'escalate',
        findings: [{ id: 'f1', severity: 'blocking', title: 'stuck', detail_md: '' }],
      },
    })
  })

  test('the same finding id twice in a row escalates instead of looping', () => {
    const priorRound: RecordedRound = {
      loop: 'impl',
      round: 1,
      verdict: 'revise',
      findings: [{ id: 'f1', severity: 'major', title: 'still broken', detail_md: '' }],
    }
    const decision = advance(
      graph,
      'validate',
      {
        status: 'ok',
        verdict: 'revise',
        findings: [{ id: 'f1', severity: 'major', title: 'still broken', detail_md: '' }],
      },
      [priorRound],
      caps,
    )

    expect(decision).toEqual({
      kind: 'park',
      reason: 'repeated_finding',
      resume: 'validate',
      record: {
        loop: 'impl',
        round: 2,
        verdict: 'revise',
        findings: [{ id: 'f1', severity: 'major', title: 'still broken', detail_md: '' }],
      },
    })
  })

  test('a different finding id does not trip the repeat streak', () => {
    const priorRound: RecordedRound = {
      loop: 'impl',
      round: 1,
      verdict: 'revise',
      findings: [{ id: 'f1', severity: 'major', title: 'still broken', detail_md: '' }],
    }
    const decision = advance(
      graph,
      'validate',
      {
        status: 'ok',
        verdict: 'revise',
        findings: [{ id: 'f2', severity: 'major', title: 'a new issue', detail_md: '' }],
      },
      [priorRound],
      caps,
    )

    expect(decision.kind).toBe('loop')
  })

  test('a finding repeated before a rework does not count toward escalation', () => {
    const priorRound: RecordedRound = {
      loop: 'impl',
      round: 1,
      verdict: 'revise',
      findings: [{ id: 'f1', severity: 'major', title: 'still broken', detail_md: '' }],
      counted: false,
    }
    const decision = advance(
      graph,
      'validate',
      {
        status: 'ok',
        verdict: 'revise',
        findings: [{ id: 'f1', severity: 'major', title: 'still broken', detail_md: '' }],
      },
      [priorRound],
      caps,
    )

    expect(decision.kind).toBe('loop')
  })

  test('a needs_decision result with a blocking decision parks without recording a round', () => {
    expect(
      advance(graph, 'specify', { status: 'needs_decision', hasBlockingDecision: true }, [], caps),
    ).toEqual({
      kind: 'park',
      reason: 'needs_decision',
      resume: 'specify',
    })
  })

  test('an ok result carrying a blocking decision still parks, not just needs_decision', () => {
    expect(
      advance(graph, 'specify', { status: 'ok', hasBlockingDecision: true }, [], caps),
    ).toEqual({
      kind: 'park',
      reason: 'needs_decision',
      resume: 'specify',
    })
  })

  test('an ok result carrying only non-blocking decisions advances normally', () => {
    const decision = advance(
      graph,
      'specify',
      { status: 'ok', hasBlockingDecision: false },
      [],
      caps,
    )
    expect(decision.kind).toBe('advance')
  })

  test('AC-1206: a needs_decision status with only non-blocking decisions still advances', () => {
    const decision = advance(
      graph,
      'specify',
      { status: 'needs_decision', hasBlockingDecision: false },
      [],
      caps,
    )
    expect(decision.kind).toBe('advance')
  })

  test('a blocking decision alongside an escalate verdict still records the round', () => {
    const decision = advance(
      graph,
      'validate',
      {
        status: 'ok',
        verdict: 'escalate',
        findings: [{ id: 'f1', severity: 'blocking', title: 'stuck', detail_md: '' }],
        hasBlockingDecision: true,
      },
      [],
      caps,
    )

    expect(decision).toEqual({
      kind: 'park',
      reason: 'needs_decision',
      resume: 'validate',
      record: {
        loop: 'impl',
        round: 1,
        verdict: 'escalate',
        findings: [{ id: 'f1', severity: 'blocking', title: 'stuck', detail_md: '' }],
      },
    })
  })

  test('advancing from a gate is a programming error, not a transition', () => {
    expect(() => advance(graph, 'human_spec_gate', { status: 'ok' }, [], caps)).toThrow(
      /not a stage node/,
    )
  })
})

describe('pipeline profiles', () => {
  const compact = instantiateDefinition(FEATURE_BUGFIX_COMPACT)

  test('the declared size selects the profile', () => {
    expect(definitionForSize('feature', 'small')).toBe(FEATURE_BUGFIX_COMPACT)
    expect(definitionForSize('feature', 'medium')).toBe(FEATURE_BUGFIX_PIPELINE)
    expect(definitionForSize('bugfix', 'large')).toBe(FEATURE_BUGFIX_PIPELINE)
    expect(definitionFor('feature', 'full')).toBe(FEATURE_BUGFIX_PIPELINE)
  })

  test('the compact profile drops the spec review and nothing else', () => {
    const kept = new Set(FEATURE_BUGFIX_COMPACT.nodes.map((node) => node.key))
    const dropped = FEATURE_BUGFIX_PIPELINE.nodes
      .map((node) => node.key)
      .filter((key) => !kept.has(key))

    expect(dropped).toEqual(['spec_review'])
  })

  test('AC-640: the compact profile keeps the spine and every human gate', () => {
    const keys = FEATURE_BUGFIX_COMPACT.nodes.map((node) => node.key)
    const spine: readonly TaskState[] = [
      'planning',
      'specify',
      'implement',
      'validate',
      'summarize',
      'publish',
      ...HUMAN_GATES,
    ]
    for (const key of spine) {
      expect(keys).toContain(key)
    }
    expect(FEATURE_BUGFIX_COMPACT.terminal).toBe(FEATURE_BUGFIX_PIPELINE.terminal)
  })

  test('specification walks straight to the spec gate under the compact profile', () => {
    expect(forwardTarget(compact, 'specify')).toBe('human_spec_gate')
    expect(forwardTarget(graph, 'specify')).toBe('spec_review')
  })

  test('the compact profile reaches archive through all three gates', () => {
    let state: TaskState = compact.entry
    const walked: TaskState[] = [state]
    for (let step = 0; step < 20 && state !== compact.terminal; step += 1) {
      const node = compact.nodes.find((candidate) => candidate.key === state)
      state = node?.kind === 'gate' ? node.approve : forwardTarget(compact, state)
      expect(canTransition(compact, walked[walked.length - 1] as TaskState, state)).toBe(true)
      walked.push(state)
    }

    expect(state).toBe(compact.terminal)
    for (const gate of HUMAN_GATES) expect(walked).toContain(gate)
  })

  test('a reduction stranding a gate target is refused, naming the profile', () => {
    const stranded: PipelineDefinition = {
      ...FEATURE_BUGFIX_PIPELINE,
      id: 'stranded',
      nodes: FEATURE_BUGFIX_PIPELINE.nodes.filter((node) => node.key !== 'implement'),
    }

    expect(validateReduction(FEATURE_BUGFIX_PIPELINE, stranded).join('\n')).toMatch(
      /stranded.*implement.*drops/s,
    )
  })

  test('a reduction that reorders its base is refused', () => {
    const [first, second, ...rest] = FEATURE_BUGFIX_PIPELINE.nodes
    const reordered: PipelineDefinition = {
      ...FEATURE_BUGFIX_PIPELINE,
      id: 'reordered',
      nodes: [second as StageNode, first as StageNode, ...rest],
    }

    expect(validateReduction(FEATURE_BUGFIX_PIPELINE, reordered).join('\n')).toContain(
      'is not a node of feature-bugfix at or after this position',
    )
  })

  test('a reduction whose kept node was edited is refused', () => {
    const edited: PipelineDefinition = {
      ...FEATURE_BUGFIX_PIPELINE,
      id: 'edited',
      nodes: FEATURE_BUGFIX_PIPELINE.nodes.map((node) =>
        node.key === 'specify' ? { ...node, role: 'summarizer' as const } : node,
      ),
    }

    expect(validateReduction(FEATURE_BUGFIX_PIPELINE, edited).join('\n')).toContain(
      "differs from feature-bugfix's node of the same key",
    )
  })

  test('loading a broken profile catalog throws naming the defect', () => {
    const broken: PipelineDefinition = {
      ...FEATURE_BUGFIX_PIPELINE,
      id: 'broken',
      nodes: FEATURE_BUGFIX_PIPELINE.nodes.filter((node) => node.key !== 'implement'),
    }

    expect(() =>
      loadPipelineProfiles({ feature: { full: FEATURE_BUGFIX_PIPELINE, compact: broken } }),
    ).toThrow(/broken.*implement/s)
  })
})

describe('conditional nodes', () => {
  test('AC-423: a predicate reading a stage outcome is refused', () => {
    const circular: PredicateSpec = {
      reads: ['checkedNodeVerdict'],
      takesThreshold: true,
      evaluate: () => ({ holds: false, reason: 'the last check passed' }),
    }

    expect(
      conditionDefects({ predicate: 'spec_scenarios_at_least', threshold: 1 }, circular).join('\n'),
    ).toMatch(/reads stage outcomes.*checkedNodeVerdict/)
  })

  test('a predicate the registry does not hold is refused', () => {
    expect(
      conditionDefects({ predicate: 'invented' as PredicateId, threshold: 1 }, undefined),
    ).toEqual(['predicate "invented" is not in the registry'])
  })

  test('the shipped predicates read only input facts', () => {
    for (const [id, spec] of Object.entries(NODE_PREDICATES)) {
      const threshold = spec.takesThreshold ? 1 : undefined

      expect(conditionDefects({ predicate: id as PredicateId, threshold }, spec)).toEqual([])
    }
  })

  it('refuses a threshold given to a predicate that takes none', () => {
    expect(
      conditionDefects(
        { predicate: 'spec_suite_in_force', threshold: 1 },
        NODE_PREDICATES.spec_suite_in_force,
      ).join('\n'),
    ).toMatch(/takes no threshold/)
  })

  it('refuses a missing threshold on a predicate that needs one', () => {
    expect(
      conditionDefects(
        { predicate: 'spec_scenarios_at_least' },
        NODE_PREDICATES.spec_scenarios_at_least,
      ).join('\n'),
    ).toMatch(/needs a threshold/)
  })

  it('rejects a catalog whose condition and predicate disagree about a threshold', () => {
    const mismatched = def({
      nodes: [
        {
          kind: 'stage',
          key: 'implement',
          role: 'implementer',
          binding: 'role_default',
          condition: { predicate: 'spec_suite_in_force', threshold: 2 },
        },
      ],
    })

    expect(validateDefinition(mismatched).join('\n')).toMatch(/implement.*takes no threshold/)
  })

  test('AC-421: the spec review runs at the floor and is skipped below it', () => {
    const review = graph.nodes.find((node) => node.key === 'spec_review') as StageNode
    const facts = { specSuiteInForce: true }

    expect(evaluateCondition(review, { ...facts, specScenarioCount: 4 }).holds).toBe(true)
    const skipped = evaluateCondition(review, { ...facts, specScenarioCount: 3 })
    expect(skipped.holds).toBe(false)
    expect(skipped.reason).toMatch(/3 scenario/)
  })

  it('takes the first failing condition of several, so the reason names the real cause', () => {
    const review = graph.nodes.find((node) => node.key === 'spec_review') as StageNode
    const skipped = evaluateCondition(review, { specSuiteInForce: false, specScenarioCount: 0 })

    expect(skipped.holds).toBe(false)
    expect(skipped.reason).toMatch(/no specification suite/)
  })

  it('runs a node whose fact could not be assembled', () => {
    const specify = graph.nodes.find((node) => node.key === 'specify') as StageNode

    expect(evaluateCondition(specify, {}).holds).toBe(true)
  })

  test('an unconditional node always runs', () => {
    const implement = graph.nodes.find((node) => node.key === 'implement') as StageNode
    expect(evaluateCondition(implement, { specScenarioCount: 0 }).holds).toBe(true)
  })

  it('AC-429: a gate may carry a condition, and its predicate is checked at load', () => {
    const gate = graph.nodes.find((node) => node.key === 'human_spec_gate') as GateNode

    expect(evaluateCondition(gate, { specSuiteInForce: true }).holds).toBe(true)
    expect(evaluateCondition(gate, { specSuiteInForce: false }).holds).toBe(false)

    const circular = def({
      nodes: [
        { kind: 'stage', key: 'implement', role: 'implementer', binding: 'role_default' },
        {
          kind: 'gate',
          key: 'human_final_gate',
          approve: 'archived',
          condition: { predicate: 'invented' as PredicateId },
        },
      ],
    })

    expect(validateDefinition(circular).join('\n')).toMatch(/human_final_gate.*not in the registry/)
  })
})

describe('session resumption', () => {
  const withResume = (resumes: TaskState, role: StageNode['role'] = 'researcher') =>
    def({
      nodes: [
        { kind: 'stage', key: 'research', role: 'researcher', binding: 'role_default' },
        { kind: 'stage', key: 'implement', role, binding: 'role_default', resumes },
      ],
    })

  test('resuming an earlier node of the same role is well-formed', () => {
    expect(validateDefinition(withResume('research'))).toEqual([])
  })

  test('AC-424: resuming a later node is refused naming the direction', () => {
    const broken = def({
      nodes: [
        {
          kind: 'stage',
          key: 'research',
          role: 'researcher',
          binding: 'role_default',
          resumes: 'implement',
        },
        { kind: 'stage', key: 'implement', role: 'researcher', binding: 'role_default' },
      ],
    })

    expect(validateDefinition(broken).join('\n')).toMatch(/implement.*not strictly earlier/)
  })

  test('resuming a node the definition does not contain is refused', () => {
    expect(validateDefinition(withResume('summarize')).join('\n')).toMatch(
      /summarize.*does not contain/,
    )
  })

  test('a session does not carry between roles', () => {
    expect(validateDefinition(withResume('research', 'summarizer')).join('\n')).toMatch(
      /does not carry between roles/,
    )
  })

  test('AC-426: a profile dropping a resumed node is refused', () => {
    const base = withResume('research')
    const reduction: PipelineDefinition = {
      ...base,
      id: 'dropped-base',
      nodes: base.nodes.filter((node) => node.key !== 'research'),
    }

    expect(validateReduction(base, reduction).join('\n')).toMatch(/resumes "research".*drops/)
  })
})

/**
 * REQ-602, REQ-1706. The spec convention decides whether the specification segment runs.
 * These pin the shape of that: the segment is skipped rather than dropped, the spine it
 * left behind is still mandatory, and the two remaining gates are not skippable at all.
 */
describe('the spec convention decides whether the specification segment runs', () => {
  const SPINE: TaskState[] = ['planning', 'implement', 'validate', 'summarize', 'publish']
  const SPEC_SEGMENT: TaskState[] = ['specify', 'human_spec_gate']

  const shipped = () =>
    TASK_TYPES.flatMap((type) => PIPELINE_PROFILES.map((profile) => definitionFor(type, profile)))

  it('every shipped profile contains the spine, which carries no condition', () => {
    for (const definition of shipped()) {
      for (const key of SPINE) {
        const node = definition.nodes.find((candidate) => candidate.key === key)

        expect(node, `${definition.id} is missing ${key}`).toBeDefined()
        expect(conditionsOf(node as PipelineNode)).toEqual([])
      }
    }
  })

  it('AC-644: the specification segment is on the graph, and conditional', () => {
    for (const definition of shipped()) {
      for (const key of SPEC_SEGMENT) {
        const node = definition.nodes.find((candidate) => candidate.key === key)

        expect(node, `${definition.id} is missing ${key}`).toBeDefined()
        expect(conditionsOf(node as PipelineNode).map((one) => one.predicate)).toContain(
          'spec_suite_in_force',
        )
      }
    }
  })

  it('AC-643: the kickoff gate and the final gate carry no condition', () => {
    for (const definition of shipped()) {
      for (const key of ['human_kickoff_gate', 'human_final_gate'] as TaskState[]) {
        const node = definition.nodes.find((candidate) => candidate.key === key)

        expect(node, `${definition.id} is missing ${key}`).toBeDefined()
        expect(conditionsOf(node as PipelineNode)).toEqual([])
      }
    }
  })

  it('a predicate may read the repository convention, and the fact carrying it exists', () => {
    expect(Object.keys(NODE_FACT_KINDS)).toContain('specSuiteInForce')
    expect(factKind('specSuiteInForce')).toBe('input')
    expect(NODE_PREDICATES.spec_suite_in_force.reads).toContain('specSuiteInForce')
  })

  it('the fact says whether a suite is in force, not which convention governs it', () => {
    // `openspec` and `custom` differ in convention and not in whether the segment runs,
    // so the fact the predicate reads must not be able to tell them apart.
    expect(Object.keys(NODE_FACT_KINDS)).not.toContain('specConvention')
  })
})
