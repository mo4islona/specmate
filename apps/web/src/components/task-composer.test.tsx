import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import type { ConsoleDestination } from '../lib/task-console.ts'
import { type OpenQuestion, TaskComposer } from './task-composer.tsx'

const ASKING: ConsoleDestination = {
  kind: 'question',
  nodeKey: 'kickoff_brief',
  label: 'Your answer',
  line: 'Unblocks Kickoff brief · 3 questions after this one',
  unavailable: null,
  tone: 'asking',
  submit: 'Answer',
  placeholder: 'Answer…',
  head: null,
}

const SPENT: ConsoleDestination = {
  kind: 'nowhere',
  nodeKey: null,
  label: 'Note on the record',
  line: 'Nothing will run until the cap moves',
  unavailable: 'The budget is spent.',
  tone: 'spent',
  submit: 'Send',
  placeholder: 'Raise the cap to send anything',
  head: { to: 'nowhere', note: '$20.00 of $20.00 spent' },
}

function question(overrides: Partial<OpenQuestion> = {}): OpenQuestion {
  return {
    label: 'Kickoff brief',
    index: 0,
    total: 4,
    promptMd: 'Should intake collapse to a single free-text field?',
    stopped: true,
    options: null,
    onPage: () => {},
    onDismiss: () => {},
    busy: false,
    ...overrides,
  }
}

const base = {
  value: '',
  onChange: () => {},
  busy: false,
  onSubmit: () => {},
}

describe('TaskComposer (REQ-921, REQ-912)', () => {
  test('the open question and the field that answers it are one box (AC-964)', () => {
    render(<TaskComposer {...base} destination={ASKING} question={question()} />)

    expect(screen.getByText(/Should intake collapse/)).not.toBeNull()
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    expect(screen.getByRole('textbox').getAttribute('aria-label')).toBe('Your answer')
    expect(screen.getByRole('button', { name: 'Answer' })).not.toBeNull()
  })

  test('the other open questions are a pager, not four stacked cards', async () => {
    const onPage = vi.fn()
    render(<TaskComposer {...base} destination={ASKING} question={question({ onPage })} />)

    expect(screen.getByText('Kickoff brief · question 1 of 4')).not.toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Question 3' }))
    expect(onPage).toHaveBeenCalledWith(2)
  })

  test('a question the task is parked on says so', () => {
    render(<TaskComposer {...base} destination={ASKING} question={question()} />)
    expect(screen.getByText('The task is stopped on this.')).not.toBeNull()

    render(<TaskComposer {...base} destination={ASKING} question={question({ stopped: false })} />)
    expect(screen.queryAllByText('The task is stopped on this.')).toHaveLength(1)
  })

  test('a state with nowhere to send disables the input and says why (AC-965)', () => {
    render(
      <TaskComposer
        {...base}
        destination={SPENT}
        escapes={<button type="button">raise the cap</button>}
      />,
    )

    const input = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(input.disabled).toBe(true)
    expect(input.placeholder).toBe('Raise the cap to send anything')
    expect(screen.getByText(/\$20\.00 of \$20\.00 spent/)).not.toBeNull()
    expect(screen.getByRole('button', { name: 'raise the cap' })).not.toBeNull()
  })

  test('the destination is stated, and there is no control that retargets it (AC-962)', () => {
    render(
      <TaskComposer
        {...base}
        destination={{
          kind: 'running-node',
          nodeKey: 'implement',
          label: 'Message to implement',
          line: 'Picked up by Implement on its next run',
          unavailable: null,
          tone: 'running',
          submit: 'Send',
          placeholder: 'Ask Implement something, or steer it…',
          head: null,
        }}
      />,
    )

    expect(screen.getByText(/Picked up by Implement on its next run/)).not.toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
  })
})
