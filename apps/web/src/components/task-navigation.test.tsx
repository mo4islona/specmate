import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import type { TaskSummary } from '../lib/api-client.ts'
import { TaskNavigation, taskGroup } from './task-navigation.tsx'

const listTasks = vi.hoisted(() => vi.fn())
const listAttention = vi.hoisted(() => vi.fn())
vi.mock('../lib/api-client.ts', () => ({ listTasks, listAttention }))

function task(id: string, status: TaskSummary['status'], overrides: Partial<TaskSummary> = {}) {
  return { id, status, title: `${id} title`, slug: `${id}-slug`, ...overrides } as TaskSummary
}

function draw(tasks: TaskSummary[], attention: string[] = [], path = '/') {
  listTasks.mockResolvedValue({ tasks })
  listAttention.mockResolvedValue({ items: attention.map((id) => ({ task: { id } })) })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(
    <QueryClientProvider client={client}>
      <Router hook={memoryLocation({ path }).hook}>
        <TaskNavigation />
      </Router>
    </QueryClientProvider>,
  )
}

describe('taskGroup', () => {
  it('pins every attention task before status-based groups', () => {
    const attention = new Set(['failed-task', 'stalled-task'])

    expect(taskGroup(task('failed-task', 'failed'), attention)).toBe('Needs input')
    expect(taskGroup(task('stalled-task', 'implement'), attention)).toBe('Needs input')
    expect(taskGroup(task('active-task', 'implement'), attention)).toBe('Active')
    expect(taskGroup(task('done-task', 'archived'), attention)).toBe('Complete')
    expect(taskGroup(task('cancelled-task', 'cancelled'), attention)).toBe('Complete')
  })
})

describe('TaskNavigation', () => {
  it('a row is the task and the stage it is at, not a chip and a slug', async () => {
    draw([
      task('task-1', 'specify', { title: 'Keep the Y-axis edge fade', slug: 'https-github-x' }),
    ])

    const row = await screen.findByRole('link', { name: /Keep the Y-axis edge fade/ })

    expect(row.textContent).toContain('Specify')
    expect(screen.queryByText('https-github-x')).toBeNull()
  })

  it('a human gate reads as the gate it is waiting at', async () => {
    draw([task('task-1', 'human_spec_gate')], ['task-1'])

    const row = await screen.findByRole('link', { name: /task-1 title/ })

    expect(screen.getByRole('heading', { name: 'Needs input' })).toBeTruthy()
    expect(row.textContent).toContain('Spec gate')
  })

  it('a task waiting on the owner breathes and wears a halo; a moving one only breathes', async () => {
    draw(
      [task('gate', 'human_spec_gate'), task('run', 'implement'), task('old', 'archived')],
      ['gate'],
    )

    const rows = await screen.findAllByRole('link')
    const marks = rows.map((row) => ({
      breathes: row.querySelector('.animate-breath') !== null,
      halo: row.querySelector('[data-halo]') !== null,
    }))

    // Needs input, Active, Complete — in the order the rail draws its groups.
    expect(marks).toEqual([
      { breathes: true, halo: true },
      { breathes: true, halo: false },
      { breathes: false, halo: false },
    ])
  })

  it('the task being read is the current page', async () => {
    draw([task('task-1', 'implement'), task('task-2', 'implement')], [], '/tasks/task-2/files')

    const rows = await screen.findAllByRole('link')

    expect(rows.map((row) => row.getAttribute('aria-current'))).toEqual([null, 'page'])
  })
})
