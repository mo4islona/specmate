import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { TaskStateSentence } from '../lib/task-state.ts'
import { TaskHeader } from './task-header.tsx'

const WAITING: TaskStateSentence = {
  tone: 'attention',
  headline: 'Waiting on you',
  detail: '4 questions from kickoff brief',
}

describe('TaskHeader (REQ-920)', () => {
  it('the state reads as a sentence, not as chips to decode', () => {
    render(<TaskHeader title="Launch work" state={WAITING} />)

    expect(screen.getByRole('heading', { name: 'Launch work' })).not.toBeNull()
    expect(screen.getByText(/Waiting on you/)).not.toBeNull()
    expect(screen.getByText(/4 questions from kickoff brief/)).not.toBeNull()
  })

  it('what qualifies the state sits beside it rather than in the rail', () => {
    render(
      <TaskHeader title="Launch work" state={WAITING} badges={<span>harness gap: partial</span>} />,
    )

    expect(screen.getByText('harness gap: partial')).not.toBeNull()
  })

  it('the header is about the task, so the event stream is not reported in it', () => {
    render(<TaskHeader title="Launch work" state={WAITING} />)

    // The shell's mark carries the connection: a badge here shoved the
    // repository onto a second line every time the stream blinked.
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByText(/stream|reconnecting/i)).toBeNull()
  })
})
