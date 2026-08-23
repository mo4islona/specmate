import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { TaskDetail, TimelineEvent } from '../lib/api-client.ts'
import type { PipelineNodeView } from '../lib/task-pipeline.ts'
import { RunLog } from './run-log.tsx'

type Stage = TaskDetail['stages'][number]

function stage(overrides: Partial<Stage> = {}): Stage {
  return {
    id: 'stage-1',
    nodeKey: 'implement',
    status: 'succeeded',
    attempt: 0,
    acceptedCommit: null,
    startedAt: '2026-08-16T10:00:00.000Z',
    finishedAt: '2026-08-16T10:01:36.000Z',
    interruptionCleanupStatus: null,
    telemetry: { costUsd: 1.66, model: 'claude-opus-5', tokens: { input: 24_100 } },
    ...overrides,
  } as Stage
}

function event(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    seq: 1,
    stageId: 'stage-1',
    type: 'stage.activity',
    payload: { tool: 'Read', target: 'packages/core/src/state.ts' },
    createdAt: '2026-08-16T10:00:30.000Z',
    ...overrides,
  } as TimelineEvent
}

function node(overrides: Partial<PipelineNodeView> = {}): PipelineNodeView {
  return {
    key: 'implement',
    kind: 'stage',
    label: 'Implement',
    role: 'implementer',
    binding: null,
    state: 'done',
    stoppedReason: null,
    current: false,
    runs: [stage()],
    latest: stage(),
    ...overrides,
  } as PipelineNodeView
}

const props = {
  repoUrl: 'https://github.com/owner/repo',
  onClose: () => {},
  onComment: () => {},
}

describe('RunLog (REQ-914, REQ-915)', () => {
  test('a run states its spend and its model where the thread no longer does', () => {
    render(<RunLog {...props} node={node()} events={[event()]} />)

    expect(screen.getByText('1m 36s')).not.toBeNull()
    expect(screen.getByText('$1.66')).not.toBeNull()
    expect(screen.getByText('24.1k tok')).not.toBeNull()
    expect(screen.getByText('opus-5')).not.toBeNull()
  })

  test('the run’s activity is here, named as an action', () => {
    render(<RunLog {...props} node={node()} events={[event()]} />)

    expect(screen.getByText('Reading packages/core/src/state.ts')).not.toBeNull()
  })

  test('activity from another run does not leak into this one', () => {
    render(<RunLog {...props} node={node()} events={[event({ stageId: 'stage-9' })]} />)

    expect(screen.queryByText(/Reading/)).toBeNull()
    expect(screen.getByText('No activity was reported for this run.')).not.toBeNull()
  })

  test('a comment is offered where the run is, not from a list of stages', () => {
    render(<RunLog {...props} node={node()} events={[]} />)

    expect(screen.getByRole('button', { name: /comment on this run/i })).not.toBeNull()
  })
})
