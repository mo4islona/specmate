import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import type { LineEntry, TurnEntry } from '../lib/task-thread.ts'
import { diffLine } from '../test-helpers.ts'
import { ThreadView } from './thread-view.tsx'

function turn(overrides: Partial<TurnEntry> = {}): TurnEntry {
  return {
    kind: 'turn',
    id: 'event-1',
    at: '2026-08-16T10:00:00.000Z',
    author: 'owner',
    verb: 'commented',
    title: 'Owner comment',
    label: 'You',
    body: 'Keep the migration reversible.',
    decisionId: null,
    ...overrides,
  }
}

function line(overrides: Partial<LineEntry> = {}): LineEntry {
  return {
    kind: 'line',
    id: 'event-2',
    at: '2026-08-16T10:00:30.000Z',
    shape: 'call',
    action: 'Edited',
    target: 'packages/core/src/state.ts',
    tone: 'plain',
    live: false,
    seq: 2,
    edit: null,
    ...overrides,
  }
}

/** An edit block reads its whole patch through a query; nothing here asks it to. */
function renderWithClient(element: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(<QueryClientProvider client={client}>{element}</QueryClientProvider>)
}

const LONG_ANSWER =
  'One field, and the planner infers the repository, the base branch and the budget from it — ' +
  'each of them confirmed at the kickoff gate before anything runs, so nothing is guessed silently.'

describe('ThreadView (REQ-919, REQ-915)', () => {
  it('the owner’s side carries no name, and the moment is not on the screen', () => {
    render(<ThreadView entries={[turn()]} taskId="task-1" />)

    expect(screen.getByText('Keep the migration reversible.')).not.toBeNull()
    // The side says whose turn it is; the label would be the same word twice.
    expect(screen.queryByText('You')).toBeNull()
    expect(screen.getByRole('listitem').getAttribute('title')).toMatch(/\d/)
  })

  it('a node speaks under its own name', () => {
    render(
      <ThreadView
        taskId="task-1"
        entries={[turn({ author: 'task', label: 'Kickoff gate', verb: 'asked' })]}
      />,
    )

    expect(screen.getByText('Kickoff gate')).not.toBeNull()
  })

  it('an entry with nothing said is a neutral marker with the time on it', () => {
    render(
      <ThreadView
        taskId="task-1"
        entries={[turn({ body: null, verb: 'launched this task', title: 'Task launched' })]}
      />,
    )

    // Neutral, because there is no balloon to give it a voice.
    expect(screen.getByText('Task launched')).not.toBeNull()
    expect(screen.queryByText('launched this task')).toBeNull()
    expect(screen.getByRole('time').textContent).toMatch(/\d/)
    expect(screen.getByRole('listitem').querySelector('[data-balloon]')).toBeNull()
  })

  it('a plain comment is the balloon, with no verb repeating what it already is', () => {
    render(<ThreadView entries={[turn()]} taskId="task-1" />)

    expect(screen.getByRole('listitem').querySelector('[data-balloon]')).not.toBeNull()
    expect(screen.queryByText('commented')).toBeNull()
  })

  it('an answered question is clamped until the owner opens it (AC-958)', async () => {
    const user = userEvent.setup()
    render(
      <ThreadView
        taskId="task-1"
        entries={[turn({ decisionId: 'd1', verb: 'answered', body: LONG_ANSWER })]}
      />,
    )

    const body = screen.getByText(LONG_ANSWER).closest('div')
    expect(body?.className).toContain('line-clamp-2')

    await user.click(screen.getByRole('button', { name: /read the whole thing/i }))
    expect(screen.getByText(LONG_ANSWER).closest('div')?.className).not.toContain('line-clamp-2')
  })

  it('an exchange that already fits is not offered a control that opens nothing', () => {
    render(
      <ThreadView
        taskId="task-1"
        entries={[turn({ decisionId: 'd1', verb: 'answered', body: 'One field.' })]}
      />,
    )

    expect(screen.queryByRole('button', { name: /read the whole thing/i })).toBeNull()
  })

  it('a tool use reads as the verb and its object, with the moment off the screen', () => {
    render(<ThreadView entries={[line()]} taskId="task-1" />)

    expect(screen.getByText('Edited')).not.toBeNull()
    expect(screen.getByText('(packages/core/src/state.ts)')).not.toBeNull()
    // No control to open anything: this is the log, not a link to one.
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByRole('listitem').getAttribute('title')).toMatch(/\d/)
  })

  it('a tool use that changed a file shows what it changed — AC-992', () => {
    const edit = {
      path: 'openspec/changes/pie-charts/proposal.md',
      additions: 2,
      deletions: 1,
      preview: '@@ -1,2 +1,3 @@\n one\n-two\n+TWO\n+three',
      clamped: false,
      truncated: false,
      anchored: true,
    }

    renderWithClient(
      <ThreadView taskId="task-1" entries={[line({ action: 'Wrote', target: edit.path, edit })]} />,
    )

    expect(screen.getByText('Wrote')).not.toBeNull()
    expect(screen.getByText('(openspec/changes/pie-charts/proposal.md)')).not.toBeNull()
    expect(screen.getByText(/Added 2 lines, removed 1 line/)).not.toBeNull()
    expect(diffLine('+TWO')).not.toBeNull()
  })

  it('a tool use that changed nothing keeps its single line — AC-994', () => {
    render(<ThreadView entries={[line({ action: 'Read' })]} taskId="task-1" />)

    expect(screen.getByText('Read')).not.toBeNull()
    expect(screen.queryByText(/Added/)).toBeNull()
  })

  it('something that happened to the run is a sentence with its particulars beneath it', () => {
    render(
      <ThreadView
        taskId="task-1"
        entries={[line({ shape: 'event', action: 'Stage accepted', target: 'fd07a56' })]}
      />,
    )

    expect(screen.getByText('Stage accepted')).not.toBeNull()
    expect(screen.getByText('fd07a56')).not.toBeNull()
    // The branch, not a second bullet: it belongs to the line above it.
    expect(screen.getByText('└')).not.toBeNull()
  })

  it('what a run is doing right now is marked as in progress (AC-940)', () => {
    render(
      <ThreadView
        taskId="task-1"
        entries={[line({ live: true }), line({ id: 'event-3', live: false })]}
      />,
    )

    const items = screen.getAllByRole('listitem')
    expect(items[0]?.getAttribute('data-live')).toBe('')
    expect(items[1]?.getAttribute('data-live')).toBeNull()
  })

  it('a person’s turn and the machine’s record share one column, in order', () => {
    render(<ThreadView taskId="task-1" entries={[line(), turn({ id: 'event-3' })]} />)

    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]?.getAttribute('data-feed-kind')).toBe('line')
    expect(items[1]?.getAttribute('data-feed-kind')).toBe('owner')
  })

  it('a thread with one entry renders that entry and no empty state', () => {
    render(<ThreadView entries={[turn()]} taskId="task-1" />)

    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.queryByText(/nothing/i)).toBeNull()
  })
})

describe('the live line (REQ-915)', () => {
  it('what the run is doing now is one line at the end, with no clock on it', () => {
    render(
      <ThreadView
        taskId="task-1"
        entries={[line({ action: 'Edited', target: 'src/ui/YAxis.tsx' })]}
        live={{ action: 'Reading', target: 'src/series/pie.ts', stageId: 'stage-1' }}
      />,
    )

    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[1]?.getAttribute('data-feed-kind')).toBe('live')
    expect(items[1]?.textContent).toContain('Reading…')
    expect(items[1]?.textContent).toContain('src/series/pie.ts')
    // It is now, so it carries no moment of its own.
    expect(items[1]?.getAttribute('title')).toBeNull()
  })

  it('a step with no run under way carries no live line', () => {
    render(<ThreadView entries={[line()]} live={null} taskId="task-1" />)

    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })
})
