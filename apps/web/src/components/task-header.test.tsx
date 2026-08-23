import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { TaskStateSentence } from '../lib/task-state.ts'
import { TaskHeader } from './task-header.tsx'

const WAITING: TaskStateSentence = {
  tone: 'attention',
  headline: 'Waiting on you',
  detail: '4 questions from kickoff brief',
}

describe('TaskHeader (REQ-920)', () => {
  test('the state reads as a sentence, not as chips to decode', () => {
    render(
      <TaskHeader
        title="Launch work"
        state={WAITING}
        context="mo4islona/specmate · main"
        connection="live"
      />,
    )

    expect(screen.getByRole('heading', { name: 'Launch work' })).not.toBeNull()
    expect(screen.getByText(/Waiting on you/)).not.toBeNull()
    expect(screen.getByText(/4 questions from kickoff brief/)).not.toBeNull()
  })

  test('the repository line says what the surface being shown is about', () => {
    const { rerender } = render(
      <TaskHeader
        title="Launch work"
        state={WAITING}
        context="owner/repo · main"
        connection="live"
      />,
    )
    expect(screen.getByText('owner/repo · main')).not.toBeNull()

    rerender(
      <TaskHeader
        title="Launch work"
        state={WAITING}
        context="owner/repo · main … head"
        connection="live"
      />,
    )
    expect(screen.getByText('owner/repo · main … head')).not.toBeNull()
  })

  test('the stream indicator is labelled, so it cannot be read as the task’s state', () => {
    render(
      <TaskHeader
        title="Launch work"
        state={WAITING}
        context="owner/repo · main"
        connection="stale"
      />,
    )

    const stream = screen.getByText('stream')
    expect(stream.getAttribute('title')).toBe('event stream stale')
    // The work is amber while the stream is broken: two claims, two colours.
    expect(screen.getByText(/Waiting on you/).closest('p')?.className).toContain('amber')
  })
})
