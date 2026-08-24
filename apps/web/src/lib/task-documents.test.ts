import { describe, expect, test } from 'vitest'
import type { ArtifactSummary, TaskDetail } from './api-client.ts'
import { stepDocuments } from './task-documents.ts'
import type { PipelineNodeView } from './task-pipeline.ts'

type Stage = TaskDetail['stages'][number]

function stage(overrides: Partial<Stage> = {}): Stage {
  return {
    id: 'stage-1',
    nodeKey: 'planning',
    status: 'succeeded',
    attempt: 0,
    startedAt: '2026-08-16T10:00:00.000Z',
    finishedAt: '2026-08-16T10:05:00.000Z',
    ...overrides,
  } as Stage
}

function node(overrides: Partial<PipelineNodeView> = {}): PipelineNodeView {
  return {
    key: 'planning',
    kind: 'stage',
    label: 'Planning',
    role: 'planner',
    binding: null,
    state: 'done',
    reason: null,
    current: false,
    runs: [],
    latest: null,
    ...overrides,
  } as PipelineNodeView
}

function artifact(overrides: Partial<ArtifactSummary> = {}): ArtifactSummary {
  return {
    id: 'artifact-1',
    path: 'openspec/changes/x/proposal.md',
    kind: 'proposal',
    gitSha: null,
    updatedAt: '2026-08-16T10:04:00.000Z',
    ...overrides,
  } as ArtifactSummary
}

const PLANNING = node({ runs: [stage()], latest: stage() })

describe('stepDocuments (REQ-907, REQ-913)', () => {
  test('a step claims the documents its own runs wrote', () => {
    const documents = stepDocuments({
      artifacts: [artifact(), artifact({ id: 'a2', updatedAt: '2026-08-16T11:30:00.000Z' })],
      step: PLANNING,
      nodes: [PLANNING],
    })

    expect(documents.map((document) => document.id)).toEqual(['artifact-1'])
  })

  test('a gate shows what the step before it produced — that is what it is gating', () => {
    const gate = node({
      key: 'human_kickoff_gate',
      kind: 'gate',
      label: 'Kickoff gate',
      role: null,
    })
    const documents = stepDocuments({
      artifacts: [artifact()],
      step: gate,
      nodes: [PLANNING, gate],
    })

    expect(documents.map((document) => document.kind)).toEqual(['proposal'])
  })

  test('a document a later stage rewrote belongs to that stage, not to this one', () => {
    const specify = node({
      key: 'specify',
      label: 'Specify',
      runs: [
        stage({
          id: 'stage-2',
          nodeKey: 'specify',
          startedAt: '2026-08-16T11:00:00.000Z',
          finishedAt: '2026-08-16T11:40:00.000Z',
        }),
      ],
    })
    const rewritten = artifact({ kind: 'spec', updatedAt: '2026-08-16T11:30:00.000Z' })

    expect(
      stepDocuments({ artifacts: [rewritten], step: PLANNING, nodes: [PLANNING, specify] }),
    ).toEqual([])
    expect(
      stepDocuments({ artifacts: [rewritten], step: specify, nodes: [PLANNING, specify] }).map(
        (document) => document.kind,
      ),
    ).toEqual(['spec'])
  })

  test('a run still going claims what it has written so far', () => {
    const running = node({
      state: 'running',
      runs: [stage({ status: 'running', finishedAt: null })],
    })

    expect(
      stepDocuments({ artifacts: [artifact()], step: running, nodes: [running] }),
    ).toHaveLength(1)
  })

  test('a step that has not run shows nothing rather than the task’s whole shelf', () => {
    const pending = node({ key: 'implement', label: 'Implement', state: 'pending' })

    expect(stepDocuments({ artifacts: [artifact()], step: pending, nodes: [pending] })).toEqual([])
  })
})
