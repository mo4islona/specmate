import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import type { PipelineNodeView } from '../lib/task-pipeline.ts'
import { PipelineRail } from './pipeline-rail.tsx'

function node(overrides: Partial<PipelineNodeView> = {}): PipelineNodeView {
  return {
    key: 'research',
    kind: 'stage',
    label: 'Research',
    role: 'researcher',
    binding: null,
    state: 'pending',
    reason: null,
    current: false,
    runs: [],
    latest: null,
    ...overrides,
  } as PipelineNodeView
}

const props = {
  baseline: null,
  repoUrl: 'https://github.com/owner/repo',
  selectedKey: null,
  onSelect: () => {},
}

describe('PipelineRail (REQ-914)', () => {
  test('nodes that have not run fold into one line naming how many', () => {
    render(
      <PipelineRail
        {...props}
        nodes={[
          node({ key: 'planning', label: 'Planning', state: 'done' }),
          node({ key: 'research', label: 'Research' }),
          node({ key: 'spec_review', label: 'Spec review' }),
          node({ key: 'human_spec_gate', label: 'Spec gate' }),
          node({ key: 'implement', label: 'Implement' }),
          node({ key: 'verify', label: 'Verify' }),
        ]}
      />,
    )

    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByText(/Research, Spec review, Spec gate, \+2 more/)).not.toBeNull()
  })

  test('a stopped node keeps its place and states the reason', () => {
    render(
      <PipelineRail
        {...props}
        nodes={[
          node({
            key: 'implement',
            label: 'Implement',
            state: 'stopped',
            reason: 'failed 3 times',
          }),
        ]}
      />,
    )

    expect(screen.getByText('failed 3 times')).not.toBeNull()
  })

  test('activating a node is what opens its run log', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <PipelineRail
        {...props}
        onSelect={onSelect}
        nodes={[node({ key: 'planning', label: 'Planning', state: 'done' })]}
      />,
    )

    await user.click(screen.getByRole('button', { name: /planning/i }))
    expect(onSelect).toHaveBeenCalledWith('planning')
  })
})
