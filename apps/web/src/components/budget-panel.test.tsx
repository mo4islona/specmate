import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import type { TaskDetail } from '../lib/api-client.ts'
import { BudgetPanel } from './budget-panel.tsx'

type Budgets = TaskDetail['task']['budgets']
type Spend = TaskDetail['spend']

function budgets(overrides: Partial<Budgets> = {}): Budgets {
  return { max_cost_usd: 20, max_wall_clock_minutes: 180, ...overrides }
}

function spend(overrides: Partial<Spend> = {}): Spend {
  return { costUsd: 5, costComplete: true, agentMinutes: 30, ...overrides }
}

describe('BudgetPanel', () => {
  test('renders both budgets and their spend', () => {
    const rendered = renderToStaticMarkup(
      <BudgetPanel budgets={budgets()} spend={spend({ costUsd: 5, agentMinutes: 30 })} />,
    )

    expect(rendered).toContain('$5.00 of $20.00')
    expect(rendered).toContain('30.0 of 180 min')
  })

  test('a task with unreported cost renders the incompleteness rather than a bare number — AC-1512', () => {
    const rendered = renderToStaticMarkup(
      <BudgetPanel
        budgets={budgets()}
        spend={spend({ costUsd: 0, costComplete: false, agentMinutes: 12 })}
      />,
    )

    expect(rendered).toContain('$0.00 of $20.00')
    expect(rendered).toContain('incomplete')
  })

  test('agent-minutes never render as incomplete, since the system times every run itself', () => {
    const rendered = renderToStaticMarkup(
      <BudgetPanel
        budgets={budgets()}
        spend={spend({ costUsd: 0, costComplete: false, agentMinutes: 12 })}
      />,
    )

    const agentMinutesSection = rendered.split('Agent-minutes')[1] ?? ''
    expect(agentMinutesSection).not.toContain('incomplete')
  })

  test('complete cost renders with no incompleteness note', () => {
    const rendered = renderToStaticMarkup(
      <BudgetPanel budgets={budgets()} spend={spend({ costComplete: true })} />,
    )

    expect(rendered).not.toContain('incomplete')
  })
})
