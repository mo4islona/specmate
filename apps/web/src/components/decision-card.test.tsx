import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DecisionItem } from '../lib/api-client.ts'
import { DecisionCard } from './decision-card.tsx'

function decision(overrides: Partial<DecisionItem> = {}): DecisionItem {
  return {
    id: 'decision-1',
    taskId: 'task-1',
    stageId: null,
    nodeKey: 'research',
    key: 'scope',
    kind: 'question',
    promptMd: 'What does *this* cover?',
    options: [],
    blocking: true,
    answerMd: null,
    answeredBy: null,
    status: 'open',
    createdAt: '2026-08-16T10:00:00.000Z',
    answeredAt: null,
    conversationId: null,
    ...overrides,
  }
}

const noop = () => {}

describe('decision card', () => {
  test('renders the question as markdown and states the task is stopped on it', () => {
    const rendered = renderToStaticMarkup(
      <DecisionCard
        decision={decision()}
        parkedOnThis={true}
        onAnswerOption={noop}
        onAnswerText={noop}
        onDismiss={noop}
      />,
    )

    expect(rendered).toContain('<em>this</em>')
    expect(rendered).toContain('The task is stopped on this.')
    expect(rendered).toContain('data-decision-status="open"')
  })

  test('a decision that did not park the task shows no stopped state', () => {
    const rendered = renderToStaticMarkup(
      <DecisionCard
        decision={decision({ blocking: false })}
        parkedOnThis={false}
        onAnswerOption={noop}
        onAnswerText={noop}
        onDismiss={noop}
      />,
    )

    expect(rendered).not.toContain('stopped on this')
  })

  test('offers options as direct actions', () => {
    const rendered = renderToStaticMarkup(
      <DecisionCard
        decision={decision({ options: [{ id: 'a', label: 'This repository' }] })}
        parkedOnThis={false}
        onAnswerOption={noop}
        onAnswerText={noop}
        onDismiss={noop}
      />,
    )

    expect(rendered).toContain('This repository')
  })

  test('the coverage decision offers all three options and a discuss action — REQ-1403, AC-1407, AC-1417', () => {
    const rendered = renderToStaticMarkup(
      <DecisionCard
        decision={decision({
          nodeKey: 'human_kickoff_gate',
          key: 'harness-coverage',
          blocking: false,
          conversationId: 'conversation-1',
          options: [
            { id: 'split', label: 'Build the harness first' },
            { id: 'proceed', label: 'Proceed without it' },
            { id: 'cancel', label: 'Cancel this task' },
          ],
        })}
        parkedOnThis={false}
        onAnswerOption={noop}
        onAnswerText={noop}
        onDismiss={noop}
        onDiscuss={noop}
      />,
    )

    expect(rendered).toContain('Build the harness first')
    expect(rendered).toContain('Proceed without it')
    expect(rendered).toContain('Cancel this task')
    expect(rendered).toContain('Discuss')
    // Non-blocking: unlike a parked question, this never claims the task is stopped.
    expect(rendered).not.toContain('stopped on this')
  })

  test('a resolved decision shows its outcome and no answer controls', () => {
    const rendered = renderToStaticMarkup(
      <DecisionCard
        decision={decision({
          status: 'answered',
          answerMd: 'The whole repository.',
          answeredBy: 'evgeny',
        })}
        parkedOnThis={false}
        onAnswerOption={noop}
        onAnswerText={noop}
        onDismiss={noop}
      />,
    )

    expect(rendered).toContain('Answered by evgeny')
    expect(rendered).toContain('The whole repository.')
    expect(rendered).not.toContain('<textarea')
  })

  test('the budget decision offers a value input per raise option and no free-text answer or dismiss — REQ-1503, REQ-1504', () => {
    const rendered = renderToStaticMarkup(
      <DecisionCard
        decision={decision({
          nodeKey: 'paused',
          key: 'budget-exhausted',
          options: [
            { id: 'raise:max_cost_usd', label: 'Raise the cost budget' },
            { id: 'cancel', label: 'Cancel this task' },
          ],
        })}
        parkedOnThis={true}
        onAnswerOption={noop}
        onAnswerText={noop}
        onDismiss={noop}
      />,
    )

    expect(rendered).toContain('Raise the cost budget')
    expect(rendered).toContain('Cancel this task')
    expect(rendered).toContain('New value for Raise the cost budget')
    expect(rendered).not.toContain('<textarea')
    expect(rendered).not.toContain('Dismiss')
  })

  test('a dismissed decision reads as dismissed, not answered', () => {
    const rendered = renderToStaticMarkup(
      <DecisionCard
        decision={decision({ status: 'dismissed', answerMd: 'Superseded.', answeredBy: 'evgeny' })}
        parkedOnThis={false}
        onAnswerOption={noop}
        onAnswerText={noop}
        onDismiss={noop}
      />,
    )

    expect(rendered).toContain('Dismissed by evgeny')
    expect(rendered).not.toContain('Answered by')
  })
})
