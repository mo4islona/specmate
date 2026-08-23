import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import type { FeedEntry } from '../lib/task-thread.ts'
import { ThreadView } from './thread-view.tsx'

function entry(overrides: Partial<FeedEntry> = {}): FeedEntry {
  return {
    id: 'event-1',
    at: '2026-08-16T10:00:00.000Z',
    author: 'owner',
    verb: 'commented',
    label: 'You',
    body: 'Keep the migration reversible.',
    nodeKey: null,
    decisionId: null,
    ...overrides,
  }
}

describe('ThreadView (REQ-919)', () => {
  test('a comment reads as one line of dialogue with its author and time', () => {
    render(<ThreadView entries={[entry()]} onOpenNode={() => {}} />)

    expect(screen.getByText('You')).not.toBeNull()
    expect(screen.getByText('commented')).not.toBeNull()
    expect(screen.getByText('Keep the migration reversible.')).not.toBeNull()
  })

  test('an answered question is clamped until the owner opens it (AC-958)', async () => {
    const user = userEvent.setup()
    render(
      <ThreadView
        entries={[entry({ decisionId: 'decision-1', verb: 'answered', body: 'One field.' })]}
        onOpenNode={() => {}}
      />,
    )

    const body = screen.getByText('One field.').closest('div')
    expect(body?.className).toContain('line-clamp-2')

    await user.click(screen.getByRole('button', { name: /read the whole thing/i }))
    expect(screen.getByText('One field.').closest('div')?.className).not.toContain('line-clamp-2')
  })

  test('a line the machine produced offers its run log rather than explaining itself', async () => {
    const user = userEvent.setup()
    const onOpenNode = vi.fn()
    render(
      <ThreadView
        entries={[
          entry({ author: 'task', label: 'Implement', verb: 'failed', nodeKey: 'implement' }),
        ]}
        onOpenNode={onOpenNode}
      />,
    )

    await user.click(screen.getByRole('button', { name: /run log/i }))
    expect(onOpenNode).toHaveBeenCalledWith('implement')
  })

  test('a thread with one entry renders that entry and no empty state', () => {
    render(<ThreadView entries={[entry()]} onOpenNode={() => {}} />)

    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.queryByText(/nothing/i)).toBeNull()
  })
})
