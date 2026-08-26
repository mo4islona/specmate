import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { PipelineNodeView } from '../lib/task-pipeline.ts'
import { NodeHint } from './node-hint.tsx'

const NOW = Date.parse('2026-08-16T10:10:00.000Z')

function node(overrides: Partial<PipelineNodeView> = {}): PipelineNodeView {
  return {
    key: 'specify',
    kind: 'stage',
    label: 'Specify',
    role: 'planner',
    binding: { model: 'claude-opus-5', reasoningEffort: 'max' },
    state: 'done',
    reason: null,
    current: false,
    runs: [],
    latest: null,
    ...overrides,
  } as PipelineNodeView
}

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: 'stage-1',
    nodeKey: 'specify',
    attempt: 0,
    status: 'succeeded',
    startedAt: '2026-08-16T10:00:00.000Z',
    finishedAt: '2026-08-16T10:04:00.000Z',
    telemetry: {
      model: 'claude-opus-5',
      tokens: { input_tokens: 1_200, output_tokens: 4_400, cache_read_input_tokens: 66_000 },
      costUsd: 2.14,
    },
    ...overrides,
  }
}

describe('NodeHint', () => {
  it('carries what the rail row has no width for: the model, the runs, the spend', () => {
    render(<NodeHint node={node({ runs: [run()] as never })} now={NOW} />)

    expect(screen.getByText('opus-5 · max')).not.toBeNull()
    expect(screen.getByText('4m')).not.toBeNull()
    expect(screen.getByText(/71.6k/)).not.toBeNull()
    expect(screen.getByText('$2.14')).not.toBeNull()
    // The role is not among them: `Specify · planner` beside `model opus-5` is
    // the same fact told twice.
    expect(screen.queryByText('planner')).toBeNull()
  })

  it('splits the total, because a cache read and a fresh input token are not the same money', () => {
    render(<NodeHint node={node({ runs: [run()] as never })} now={NOW} />)

    expect(screen.getByText('in 1.2k · out 4.4k · cache read 66.0k')).not.toBeNull()
  })

  it('counts every attempt at the node, not just the one that stuck', () => {
    const runs = [
      run({ id: 'a', attempt: 0, status: 'failed' }),
      run({
        id: 'b',
        attempt: 1,
        startedAt: '2026-08-16T10:04:00.000Z',
        finishedAt: '2026-08-16T10:06:00.000Z',
      }),
    ]
    render(<NodeHint node={node({ runs: runs as never, latest: runs[1] as never })} now={NOW} />)

    expect(screen.getByText('2 attempts · 6m')).not.toBeNull()
    expect(screen.getByText('$4.28')).not.toBeNull()
  })

  it('a node that has not run offers its purpose and no grid of dashes', () => {
    render(<NodeHint node={node({ state: 'pending', role: null, binding: null })} now={NOW} />)

    expect(screen.getByText(/Continues the planning session/)).not.toBeNull()
    expect(screen.queryByText('tokens')).toBeNull()
    expect(screen.queryByText('cost')).toBeNull()
    expect(screen.getByText('not started')).not.toBeNull()
  })

  it('a stop says how it stopped, under the state word rather than beside it', () => {
    render(<NodeHint node={node({ state: 'stopped', reason: 'failed 3 times' })} now={NOW} />)

    expect(screen.getByText('failed 3 times')).not.toBeNull()
    expect(screen.getByText('stopped')).not.toBeNull()
  })

  it('a reason the length of a sentence reads as one, and never off the hint’s edge', () => {
    const reason = 'the specification declares 0 scenario(s), under the 4 this node is worth'
    render(<NodeHint node={node({ state: 'skipped', reason })} now={NOW} />)

    const said = screen.getByText(reason)

    // Beside the name it wrapped `Spec review` into two lines and then ran off
    // the hint's own 300px, over the rail behind it.
    expect(said.className).not.toContain('shrink-0')
    expect(said.parentElement).not.toBe(screen.getByText('Specify').parentElement)
  })
})
