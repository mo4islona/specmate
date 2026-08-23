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
    title: 'Owner comment',
    label: 'You',
    body: 'Keep the migration reversible.',
    nodeKey: null,
    decisionId: null,
    ...overrides,
  }
}

const LONG_ANSWER =
  'One field, and the planner infers the repository, the base branch and the budget from it — ' +
  'each of them confirmed at the kickoff gate before anything runs, so nothing is guessed silently.'

describe('ThreadView (REQ-919)', () => {
  test('the owner’s side carries no name, and the moment is not on the screen', () => {
    render(<ThreadView entries={[entry()]} onOpenNode={() => {}} />)

    expect(screen.getByText('Keep the migration reversible.')).not.toBeNull()
    // The side says whose turn it is; the label would be the same word twice.
    expect(screen.queryByText('You')).toBeNull()
    expect(screen.getByRole('listitem').getAttribute('title')).toMatch(/\d/)
  })

  test('a node speaks under its own name', () => {
    render(
      <ThreadView
        entries={[entry({ author: 'task', label: 'Kickoff gate', verb: 'asked' })]}
        onOpenNode={() => {}}
      />,
    )

    expect(screen.getByText('Kickoff gate')).not.toBeNull()
  })

  test('an entry with nothing said is a neutral marker with the time on it', () => {
    render(
      <ThreadView
        entries={[entry({ body: null, verb: 'launched this task', title: 'Task launched' })]}
        onOpenNode={() => {}}
      />,
    )

    // Neutral, because there is no balloon to give it a voice.
    expect(screen.getByText('Task launched')).not.toBeNull()
    expect(screen.queryByText('launched this task')).toBeNull()
    expect(screen.getByRole('time').textContent).toMatch(/\d/)
    expect(screen.getByRole('listitem').querySelector('[data-balloon]')).toBeNull()
  })

  test('what the machine said is left where it is, with no balloon of its own', () => {
    render(
      <ThreadView
        entries={[entry({ author: 'task', label: 'Kickoff gate', verb: 'asked' })]}
        onOpenNode={() => {}}
      />,
    )

    expect(screen.getByText('Keep the migration reversible.')).not.toBeNull()
    expect(screen.getByRole('listitem').querySelector('[data-balloon]')).toBeNull()
  })

  test('a plain comment is the balloon, with no verb repeating what it already is', () => {
    render(<ThreadView entries={[entry()]} onOpenNode={() => {}} />)

    expect(screen.getByRole('listitem').querySelector('[data-balloon]')).not.toBeNull()
    expect(screen.queryByText('commented')).toBeNull()
  })

  test('an answered question is clamped until the owner opens it (AC-958)', async () => {
    const user = userEvent.setup()
    render(
      <ThreadView
        entries={[entry({ decisionId: 'decision-1', verb: 'answered', body: LONG_ANSWER })]}
        onOpenNode={() => {}}
      />,
    )

    const body = screen.getByText(LONG_ANSWER).closest('div')
    expect(body?.className).toContain('line-clamp-2')

    await user.click(screen.getByRole('button', { name: /read the whole thing/i }))
    expect(screen.getByText(LONG_ANSWER).closest('div')?.className).not.toContain('line-clamp-2')
  })

  test('an exchange that already fits is not offered a control that opens nothing', () => {
    render(
      <ThreadView
        entries={[entry({ decisionId: 'decision-1', verb: 'answered', body: 'One field.' })]}
        onOpenNode={() => {}}
      />,
    )

    expect(screen.queryByRole('button', { name: /read the whole thing/i })).toBeNull()
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
