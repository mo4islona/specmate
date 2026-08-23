import type { ModelBindings } from '@specmate/core'
import { describe, expect, test } from 'vitest'
import type { TaskDetail } from './api-client.ts'
import { bindingBaseline, buildPipelineNodes, shortModel } from './task-pipeline.ts'

type Stage = TaskDetail['stages'][number]
type PinnedNode = NonNullable<TaskDetail['graph']>['dag']['nodes'][number]

const NODES = [
  { kind: 'stage', key: 'research', role: 'researcher', binding: 'role_default' },
  { kind: 'gate', key: 'human_spec_gate', approve: 'implement', rework: ['research'] },
  { kind: 'stage', key: 'implement', role: 'implementer', binding: 'role_default' },
] as unknown as PinnedNode[]

const BINDINGS = {
  planner: { model: 'claude-opus-5', reasoningEffort: 'high' },
  researcher: { model: 'claude-opus-5', reasoningEffort: 'high' },
  spec_writer: { model: 'claude-opus-5', reasoningEffort: 'high' },
  implementer: { model: 'claude-sonnet-5', reasoningEffort: 'medium' },
  verifier: { model: 'claude-opus-5', reasoningEffort: 'high' },
  reviewer: { model: 'claude-opus-5', reasoningEffort: 'high' },
  summarizer: { model: 'claude-opus-5', reasoningEffort: 'high' },
  answerer: { model: 'claude-opus-5', reasoningEffort: 'high' },
  retro: { model: 'claude-opus-5', reasoningEffort: 'high' },
} as ModelBindings

function stage(overrides: Partial<Stage> = {}): Stage {
  return {
    id: 'stage-1',
    taskId: 'task-1',
    graphId: 'graph-1',
    nodeKey: 'research',
    role: 'researcher',
    provider: 'claude-code',
    status: 'succeeded',
    attempt: 0,
    acceptedCommit: null,
    startedAt: '2026-08-16T10:00:00.000Z',
    finishedAt: '2026-08-16T10:05:00.000Z',
    telemetry: null,
    ...overrides,
  } as Stage
}

describe('buildPipelineNodes', () => {
  test('a gate the task sits at is the node waiting on a person', () => {
    const nodes = buildPipelineNodes({
      nodes: NODES,
      stages: [stage()],
      status: 'human_spec_gate',
      resumeStatus: null,
      modelBindings: BINDINGS,
    })

    expect(nodes.map((node) => node.state)).toEqual(['done', 'awaiting', 'pending'])
    expect(nodes[1]?.current).toBe(true)
  })

  test('a parked task marks the node it resumes into, not the parking status', () => {
    const nodes = buildPipelineNodes({
      nodes: NODES,
      stages: [stage(), stage({ id: 'stage-2', nodeKey: 'implement', status: 'running' })],
      status: 'waiting_human',
      resumeStatus: 'implement',
      modelBindings: BINDINGS,
    })

    expect(nodes[2]?.current).toBe(true)
    expect(nodes[2]?.state).toBe('running')
  })

  test('every attempt at a node is kept, oldest first', () => {
    const nodes = buildPipelineNodes({
      nodes: NODES,
      stages: [
        stage({ id: 'a', attempt: 1, status: 'running' }),
        stage({ id: 'b', attempt: 0, status: 'failed' }),
      ],
      status: 'research',
      resumeStatus: null,
      modelBindings: BINDINGS,
    })

    expect(nodes[0]?.runs.map((run) => run.id)).toEqual(['b', 'a'])
    expect(nodes[0]?.state).toBe('running')
  })

  test('a terminal task shows the pipeline behind it as passed, not as pending', () => {
    const nodes = buildPipelineNodes({
      nodes: NODES,
      stages: [stage()],
      status: 'archived',
      resumeStatus: null,
      modelBindings: BINDINGS,
    })

    expect(nodes.map((node) => node.state)).toEqual(['done', 'done', 'done'])
  })
})

describe('bindingBaseline', () => {
  test('the baseline is what most roles run, so only an override stands out', () => {
    const nodes = buildPipelineNodes({
      nodes: NODES,
      stages: [],
      status: 'research',
      resumeStatus: null,
      modelBindings: BINDINGS,
    })

    expect(bindingBaseline(nodes)).toEqual({ model: 'claude-opus-5', reasoningEffort: 'high' })
  })

  test('a graph with no stage roles has no baseline to state', () => {
    expect(bindingBaseline([])).toBeNull()
  })
})

test('a model id is shortened to the name, not the release stamp', () => {
  expect(shortModel('claude-haiku-4-5-20251001')).toBe('haiku-4-5')
  expect(shortModel('claude-opus-5')).toBe('opus-5')
})

describe('stopped nodes (REQ-914)', () => {
  test('a failed attempt is stopped, and says how many times it failed', () => {
    const nodes = buildPipelineNodes({
      nodes: NODES,
      stages: [
        stage({ id: 's1', nodeKey: 'implement', attempt: 0, status: 'failed' }),
        stage({ id: 's2', nodeKey: 'implement', attempt: 1, status: 'failed' }),
        stage({ id: 's3', nodeKey: 'implement', attempt: 2, status: 'failed' }),
      ],
      status: 'failed',
      resumeStatus: 'implement',
      modelBindings: BINDINGS,
    })
    const implement = nodes.find((node) => node.key === 'implement')

    expect(implement?.state).toBe('stopped')
    expect(implement?.reason).toBe('failed 3 times')
  })

  test('an interrupted run is stopped, and a failed cleanup says so', () => {
    const nodes = buildPipelineNodes({
      nodes: NODES,
      stages: [
        stage({
          id: 's1',
          nodeKey: 'implement',
          status: 'interrupted',
          interruptionCleanupStatus: 'failed',
        }),
      ],
      status: 'paused',
      resumeStatus: 'implement',
      modelBindings: BINDINGS,
    })

    expect(nodes.find((node) => node.key === 'implement')?.reason).toBe('stopped · cleanup failed')
  })

  test('a node that has not run carries no reason to state', () => {
    const nodes = buildPipelineNodes({
      nodes: NODES,
      stages: [],
      status: 'research',
      resumeStatus: null,
      modelBindings: BINDINGS,
    })

    expect(nodes.find((node) => node.key === 'implement')?.state).toBe('pending')
    expect(nodes.find((node) => node.key === 'implement')?.reason).toBeNull()
  })
})

describe('a skipped node', () => {
  test('AC-422: keeps its place in the rail and states why it was skipped', () => {
    const nodes = buildPipelineNodes({
      nodes: [
        { kind: 'stage', key: 'specify', role: 'planner', binding: 'role_default' },
        { kind: 'stage', key: 'spec_review', role: 'reviewer', binding: 'cross_review' },
        { kind: 'stage', key: 'implement', role: 'implementer', binding: 'role_default' },
      ] as never,
      stages: [
        stage({ nodeKey: 'specify', status: 'succeeded', role: 'planner' }),
        stage({
          nodeKey: 'spec_review',
          status: 'skipped',
          role: 'reviewer',
          skipReason: 'the specification declares 2 scenario(s), under the 4 this node is worth',
        }),
      ],
      status: 'implement',
      resumeStatus: null,
      modelBindings: {} as never,
    })

    const skipped = nodes.find((node) => node.key === 'spec_review')
    expect(skipped?.state).toBe('skipped')
    expect(skipped?.reason).toContain('2 scenario')
  })
})
