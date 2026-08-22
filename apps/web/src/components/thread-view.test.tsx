import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, test } from 'vitest'
import type { DecisionItem, TaskDetail, TimelineEvent } from '../lib/api-client.ts'
import type { ThreadChapter } from '../lib/task-thread.ts'
import { ThreadView } from './thread-view.tsx'

type Stage = TaskDetail['stages'][number]

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
    acceptedCommit: 'd4f8b12c9a3e5d7f1b2c4a6e8d0f2b4c6a8e0d2f',
    startedAt: '2026-08-16T10:00:00.000Z',
    finishedAt: '2026-08-16T10:05:00.000Z',
    telemetry: { model: 'claude-opus-5', tokens: { input: 100 }, costUsd: 0.94 },
    ...overrides,
  } as Stage
}

function event(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    seq: 1,
    taskId: 'task-1',
    stageId: 'stage-1',
    type: 'stage.completed',
    payload: {},
    createdAt: '2026-08-16T10:05:00.000Z',
    ...overrides,
  } as TimelineEvent
}

function chapter(overrides: Partial<ThreadChapter> = {}): ThreadChapter {
  return {
    id: 'stage:stage-1',
    kind: 'stage',
    nodeKey: 'research',
    stage: stage(),
    runs: 1,
    entries: [{ kind: 'event', id: 'event-1', at: '2026-08-16T10:05:00.000Z', event: event() }],
    ...overrides,
  }
}

function decision(overrides: Partial<DecisionItem> = {}): DecisionItem {
  return {
    id: 'decision-1',
    taskId: 'task-1',
    stageId: 'stage-1',
    nodeKey: 'research',
    key: 'auth-mode',
    kind: 'question',
    promptMd: 'GitHub App or a device-flow token?',
    options: [],
    blocking: true,
    answerMd: null,
    answeredBy: null,
    status: 'open',
    createdAt: '2026-08-16T10:02:00.000Z',
    answeredAt: null,
    conversationId: null,
    ...overrides,
  } as DecisionItem
}

/** Mirrors how the task screen owns the toggle set, so a click really re-renders. */
function Harness({
  chapters,
  decisions = [],
}: {
  chapters: ThreadChapter[]
  decisions?: DecisionItem[]
}) {
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set())

  return (
    <ThreadView
      chapters={chapters}
      decisionsById={new Map(decisions.map((row) => [row.id, row]))}
      repoUrl="https://github.com/acme/specmate.git"
      activeNodeKey="research"
      toggled={toggled}
      onToggle={(id) =>
        setToggled((previous) => {
          const next = new Set(previous)
          if (!next.delete(id)) next.add(id)

          return next
        })
      }
    />
  )
}

describe('thread view', () => {
  test('history is collapsed to its chapter names, and the newest chapter is open', () => {
    render(
      <Harness
        chapters={[
          chapter({ id: 'stage:one', nodeKey: 'planning', stage: stage({ nodeKey: 'planning' }) }),
          chapter(),
        ]}
      />,
    )

    expect(screen.getByRole('button', { name: /Planning/ }).getAttribute('aria-expanded')).toBe(
      'false',
    )
    expect(screen.getByRole('button', { name: /Research/ }).getAttribute('aria-expanded')).toBe(
      'true',
    )
  })

  test('opening an earlier chapter reveals its entries', async () => {
    const user = userEvent.setup()
    render(
      <Harness
        chapters={[
          chapter({
            id: 'stage:one',
            nodeKey: 'planning',
            stage: stage({ nodeKey: 'planning' }),
            entries: [
              {
                kind: 'event',
                id: 'event-9',
                at: '2026-08-16T09:30:00.000Z',
                event: event({ seq: 9, type: 'task.created', payload: { title: 'Launch work' } }),
              },
            ],
          }),
          chapter(),
        ]}
      />,
    )

    expect(screen.queryByText('Task launched')).toBeNull()
    await user.click(screen.getByRole('button', { name: /Planning/ }))
    expect(screen.getByText('Task launched')).toBeDefined()
  })

  test('a chapter header states the stage and nothing the pipeline already states', () => {
    render(<Harness chapters={[chapter()]} />)

    const header = screen.getByRole('button', { name: /Research/ })

    expect(header.textContent).toBe('Research')
  })

  test('an open decision is not repeated in the thread — it lives where it is answered', () => {
    const open = decision()
    render(
      <Harness
        chapters={[
          chapter({
            entries: [
              {
                kind: 'event',
                id: 'event-2',
                at: '2026-08-16T10:02:00.000Z',
                event: event({
                  seq: 2,
                  type: 'decision.raised',
                  payload: { decisionId: open.id },
                }),
              },
            ],
          }),
        ]}
        decisions={[open]}
      />,
    )

    expect(screen.queryByText(/GitHub App or a device-flow token/)).toBeNull()
  })

  test('a resolved decision takes its place in the history, with its outcome', () => {
    const answered = decision({
      status: 'answered',
      answerMd: 'GitHub App.',
      answeredBy: 'evgeny',
    })
    render(
      <Harness
        chapters={[
          chapter({
            entries: [
              {
                kind: 'event',
                id: 'event-2',
                at: '2026-08-16T10:02:00.000Z',
                event: event({
                  seq: 2,
                  type: 'decision.raised',
                  payload: { decisionId: answered.id },
                }),
              },
            ],
          }),
        ]}
        decisions={[answered]}
      />,
    )

    expect(screen.getByText(/GitHub App or a device-flow token/)).toBeDefined()
    expect(screen.getByText(/Answered by evgeny/)).toBeDefined()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  test('a task with no history says so', () => {
    render(<Harness chapters={[]} />)

    expect(screen.getByText('Nothing has happened yet.')).toBeDefined()
  })
})
