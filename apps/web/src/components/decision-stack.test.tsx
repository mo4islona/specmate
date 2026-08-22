import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import type { DecisionItem } from '../lib/api-client.ts'
import { DecisionStack } from './decision-stack.tsx'

function question(overrides: Partial<DecisionItem> = {}): DecisionItem {
  return {
    id: 'decision-1',
    taskId: 'task-1',
    stageId: 'stage-1',
    nodeKey: 'kickoff_brief',
    key: 'harness-scope',
    kind: 'question',
    promptMd: 'Should the harness cover the intake screen only?',
    options: [],
    blocking: true,
    answerMd: null,
    answeredBy: null,
    status: 'open',
    createdAt: '2026-08-16T10:00:00.000Z',
    answeredAt: null,
    conversationId: null,
    ...overrides,
  } as DecisionItem
}

const handlers = () => ({
  onAnswerOption: vi.fn(),
  onAnswerText: vi.fn(),
  onDismiss: vi.fn(),
  onDiscuss: undefined,
})

function renderStack(decisions: DecisionItem[]) {
  return render(
    <DecisionStack
      decisions={decisions}
      label="Blocking decisions"
      parked={true}
      busy={() => false}
      error={() => undefined}
      handlers={handlers}
    />,
  )
}

describe('decision stack', () => {
  test('one question is answerable and the rest wait as their own line', () => {
    renderStack([
      question({ id: 'a', promptMd: 'In-process DOM or a real browser?' }),
      question({ id: 'b', promptMd: 'Stub the network edge or inject a client?' }),
      question({ id: 'c', promptMd: 'Shared harness or intake only?' }),
    ])

    // Only the expanded question offers a way to answer it.
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    expect(screen.getByText(/In-process DOM or a real browser/)).toBeDefined()
    expect(screen.getByText(/Stub the network edge/)).toBeDefined()
    expect(screen.getAllByText('open')).toHaveLength(2)
  })

  test('activating a waiting question makes it the one being answered', async () => {
    const user = userEvent.setup()
    renderStack([
      question({ id: 'a', promptMd: 'In-process DOM or a real browser?' }),
      question({ id: 'b', promptMd: 'Stub the network edge or inject a client?' }),
    ])

    await user.click(screen.getByRole('button', { name: /Stub the network edge/ }))

    expect(screen.getByLabelText('Answer for harness-scope')).toBeDefined()
    expect(screen.getByRole('button', { name: /In-process DOM or a real browser/ })).toBeDefined()
  })

  test('a question that stops the task says so', () => {
    renderStack([question()])

    expect(screen.getByText('The task is stopped on this.')).toBeDefined()
  })

  test('nothing open renders nothing at all', () => {
    const { container } = renderStack([])

    expect(container.innerHTML).toBe('')
  })
})
