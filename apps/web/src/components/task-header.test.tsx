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
    render(<TaskHeader title="Launch work" state={WAITING} connection="live" />)

    expect(screen.getByRole('heading', { name: 'Launch work' })).not.toBeNull()
    expect(screen.getByText(/Waiting on you/)).not.toBeNull()
    expect(screen.getByText(/4 questions from kickoff brief/)).not.toBeNull()
  })

  test('what qualifies the state sits beside it rather than in the rail', () => {
    render(
      <TaskHeader
        title="Launch work"
        state={WAITING}
        connection="live"
        badges={<span>harness gap: partial</span>}
      />,
    )

    expect(screen.getByText('harness gap: partial')).not.toBeNull()
  })

  test('the stream indicator is labelled, so it cannot be read as the task’s state', () => {
    render(<TaskHeader title="Launch work" state={WAITING} connection="stale" />)

    const stream = screen.getByText('stream')
    expect(stream.getAttribute('title')).toBe('event stream stale')
    // The work is amber while the stream is broken: two claims, two colours.
    expect(screen.getByText(/Waiting on you/).closest('p')?.className).toContain('amber')
  })
})
