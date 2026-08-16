import { describe, expect, test } from 'bun:test'
import {
  advance,
  bindStageProvider,
  Caps,
  canTransition,
  FEATURE_BUGFIX_PIPELINE,
  graphTransitions,
  HUMAN_GATES,
  instantiateDefinition,
  loadPipelineCatalog,
  PIPELINE_CATALOG,
  type PinnedGraph,
  type PipelineDefinition,
  PipelineDefinitionError,
  type RecordedRound,
  type StageNode,
  TASK_STATES,
  type TaskState,
  validateDefinition,
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
    expect(stages.spec_review?.loopEdge).toEqual({ target: 'research', loop: 'spec' })
    expect(stages.verify?.loopEdge).toEqual({ target: 'implement', loop: 'impl' })
    expect(stages.code_review?.loopEdge).toEqual({ target: 'implement', loop: 'impl' })
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

  test('the final gate approves straight into archive while publish is deferred', () => {
    const final = FEATURE_BUGFIX_PIPELINE.nodes.find((n) => n.key === 'human_final_gate')
    expect(final?.kind === 'gate' && final.approve).toBe('archived')
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
   * final gate approves into `archived` while the publish node is deferred,
   * and a failed task may restart into any stage of its pinned graph.
   */
  const EXPECTED: Record<TaskState, readonly TaskState[]> = {
    draft: ['planning', 'cancelled'],
    planning: ['kickoff_brief', 'failed'],
    kickoff_brief: ['human_kickoff_gate', 'failed'],
    human_kickoff_gate: ['research', 'planning', 'cancelled'],
    research: ['spec_review', 'failed'],
    spec_review: ['human_spec_gate', 'research', 'failed'],
    human_spec_gate: ['implement', 'research', 'cancelled'],
    implement: ['verify', 'failed'],
    verify: ['code_review', 'implement', 'failed'],
    code_review: ['summarize', 'implement', 'failed'],
    summarize: ['human_final_gate', 'failed'],
    human_final_gate: ['archived', 'implement', 'research', 'cancelled'],
    publish: [],
    archived: [],
    waiting_human: [],
    paused: [],
    blocked: ['planning', 'cancelled'],
    cancelled: [],
    failed: [
      'planning',
      'kickoff_brief',
      'research',
      'spec_review',
      'implement',
      'verify',
      'code_review',
      'summarize',
      'cancelled',
    ],
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
      'kickoff_brief',
      'human_kickoff_gate',
      'research',
      'spec_review',
      'human_spec_gate',
      'implement',
      'verify',
      'code_review',
      'summarize',
      'human_final_gate',
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
    expect(canTransition(graph, 'spec_review', 'research')).toBe(true)
    expect(canTransition(graph, 'code_review', 'implement')).toBe(true)
    expect(canTransition(graph, 'code_review', 'summarize')).toBe(true)
    expect(canTransition(graph, 'code_review', 'human_final_gate')).toBe(false)
    expect(canTransition(graph, 'code_review', 'archived')).toBe(false)
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
    expect(canTransition(graph, 'research', 'spec_review')).toBe(true)
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
  const review = graph.nodes.find((n) => n.key === 'code_review') as StageNode
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
})

describe('advance', () => {
  const rounds = (
    ...entries: [RecordedRound['loop'], number, RecordedRound['verdict'], boolean?][]
  ): RecordedRound[] =>
    entries.map(([loop, round, verdict, counted]) => ({ loop, round, verdict, counted }))

  test('plain success advances along the forward edge', () => {
    expect(advance(graph, 'research', { status: 'ok' }, [], caps)).toEqual({
      kind: 'advance',
      to: 'spec_review',
    })
  })

  test('a loop-edged stage without a verdict is a defect, not an approval', () => {
    expect(() => advance(graph, 'verify', { status: 'ok' }, [], caps)).toThrow(/verdict/)
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
      to: 'research',
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
      to: 'research',
      record: { loop: 'spec', round: 4, verdict: 'revise', findings: [] },
    })
  })

  test('the two impl reviewers share one cap', () => {
    const used = rounds(['impl', 1, 'revise'], ['impl', 2, 'approve'], ['impl', 3, 'revise'])
    const decision = advance(graph, 'code_review', { status: 'ok', verdict: 'revise' }, used, caps)

    expect(decision).toEqual({
      kind: 'loop',
      to: 'implement',
      record: { loop: 'impl', round: 4, verdict: 'revise', findings: [] },
    })
  })

  test('escalate parks and records the verdict', () => {
    const decision = advance(
      graph,
      'code_review',
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
      resume: 'code_review',
      record: {
        loop: 'impl',
        round: 1,
        verdict: 'escalate',
        findings: [{ id: 'f1', severity: 'blocking', title: 'stuck', detail_md: '' }],
      },
    })
  })

  test('a result that needs a decision parks without recording a round', () => {
    expect(advance(graph, 'research', { status: 'needs_decision' }, [], caps)).toEqual({
      kind: 'park',
      reason: 'needs_decision',
      resume: 'research',
    })
  })

  test('advancing from a gate is a programming error, not a transition', () => {
    expect(() => advance(graph, 'human_spec_gate', { status: 'ok' }, [], caps)).toThrow(
      /not a stage node/,
    )
  })
})
