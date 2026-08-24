import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { PipelineNodeView } from '../lib/task-pipeline.ts'
import { StepHeader } from './step-header.tsx'

function node(overrides: Partial<PipelineNodeView> = {}): PipelineNodeView {
  return {
    key: 'specify',
    kind: 'stage',
    label: 'Specify',
    role: 'planner',
    binding: { model: 'claude-opus-5', reasoningEffort: 'max' },
    state: 'stopped',
    reason: 'stopped',
    current: true,
    runs: [],
    latest: null,
    ...overrides,
  } as PipelineNodeView
}

const RUN = {
  id: 'stage-1',
  nodeKey: 'specify',
  attempt: 0,
  status: 'failed',
  startedAt: '2026-08-16T10:00:00.000Z',
  finishedAt: '2026-08-16T10:04:00.000Z',
  telemetry: {
    model: 'claude-opus-5',
    tokens: { input_tokens: 1_200, output_tokens: 4_400 },
    costUsd: 3.09,
  },
}

const props = { repoUrl: 'https://github.com/acme/specmate' }

describe('StepHeader (REQ-914)', () => {
  it('the step the task stands on does not restate the state the page header just gave', () => {
    render(<StepHeader {...props} node={node()} current={true} />)

    expect(screen.getByText('Specify')).not.toBeNull()
    expect(screen.queryByText(/stopped/)).toBeNull()
  })

  it('a step the owner went back to states its own, because the header is elsewhere', () => {
    render(
      <StepHeader
        {...props}
        node={node({ key: 'planning', label: 'Planning', current: false })}
        current={false}
      />,
    )

    expect(screen.getByText(/stopped/)).not.toBeNull()
  })

  it('carries the two numbers a person checks, and nothing else on the row', () => {
    render(<StepHeader {...props} node={node({ runs: [RUN] as never })} current={true} />)

    expect(screen.getByText('4m')).not.toBeNull()
    expect(screen.getByText('$3.09')).not.toBeNull()
    // The model, the effort and the token split are behind the mark at the end
    // of the row: inline they made a run of grey text nobody read.
    expect(screen.queryByText(/opus-5/)).toBeNull()
    expect(screen.queryByText(/tokens/)).toBeNull()
  })

  it('the rest of what the step knows is one mark away', () => {
    render(<StepHeader {...props} node={node({ runs: [RUN] as never })} current={true} />)

    expect(
      screen.getByRole('button', { name: 'What Specify ran on, and what it spent' }),
    ).not.toBeNull()
  })
})
