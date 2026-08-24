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
  selectedKey: null,
  onSelect: () => {},
}

describe('PipelineRail (REQ-914)', () => {
  test('every node of the walk is listed, but only the ones with a step to read open', () => {
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

    expect(screen.getAllByRole('listitem')).toHaveLength(6)
    expect(screen.getByText('Verify')).not.toBeNull()
    expect(screen.queryByText(/more/)).toBeNull()
    // A node with no runs has no step; offering to open one opens an empty room.
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  test('the state is a mark beside the name, not a word in the column that costs', () => {
    render(
      <PipelineRail
        {...props}
        nodes={[
          node({ key: 'human_kickoff_gate', label: 'Kickoff gate', kind: 'gate', state: 'done' }),
          node({ key: 'specify', label: 'Specify', state: 'stopped', reason: 'stopped' }),
        ]}
      />,
    )

    expect(screen.queryByText('passed')).toBeNull()
    // The word survives only for a screen reader, which cannot see the mark.
    expect(screen.getByText('stopped').className).toContain('sr-only')
    expect(screen.getByTitle('done')).not.toBeNull()
    expect(screen.getByTitle('stopped')).not.toBeNull()
  })

  test('a row carries the node’s name and one fact, never a model or a commit', () => {
    render(
      <PipelineRail
        {...props}
        nodes={[
          node({
            key: 'planning',
            label: 'Planning',
            state: 'done',
            binding: { model: 'claude-opus-5', reasoningEffort: 'max' },
            latest: {
              startedAt: '2026-08-16T10:00:00.000Z',
              finishedAt: '2026-08-16T10:07:06.000Z',
              acceptedCommit: 'fd07a5612ab',
            },
          } as Partial<PipelineNodeView>),
        ]}
      />,
    )

    expect(screen.getByText('7m 6s')).not.toBeNull()
    expect(screen.queryByText(/opus-5/)).toBeNull()
    expect(screen.queryByText(/fd07a56/)).toBeNull()
  })

  test('a stop with more to say than the mark keeps its reason', () => {
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
