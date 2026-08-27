import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import type { TaskSummary } from '../lib/api-client.ts'
import { queryKeys } from '../lib/query-keys.ts'
import { TaskNavigation, taskGroup } from './task-navigation.tsx'

const listTasks = vi.hoisted(() => vi.fn())
const listAttention = vi.hoisted(() => vi.fn())
const deleteTask = vi.hoisted(() => vi.fn())
vi.mock('../lib/api-client.ts', () => ({
  ApiRequestError: class ApiRequestError extends Error {},
  deleteTask,
  listTasks,
  listAttention,
}))

function task(id: string, status: TaskSummary['status'], overrides: Partial<TaskSummary> = {}) {
  return { id, status, title: `${id} title`, slug: `${id}-slug`, ...overrides } as TaskSummary
}

function draw(tasks: TaskSummary[], attention: string[] = [], path = '/') {
  listTasks.mockResolvedValue({ tasks })
  listAttention.mockResolvedValue({ items: attention.map((id) => ({ task: { id } })) })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const { hook, history } = memoryLocation({ path, record: true })

  const view = render(
    <QueryClientProvider client={client}>
      <Router hook={hook}>
        <TaskNavigation />
      </Router>
    </QueryClientProvider>,
  )

  return { ...view, client, history }
}

beforeEach(() => vi.clearAllMocks())

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

  it('keeps permanent deletion behind terminal rows only — AC-1805, AC-1806', async () => {
    draw([
      task('archived', 'archived'),
      task('cancelled', 'cancelled'),
      task('failed', 'failed'),
      task('active', 'implement'),
    ])

    const actions = await screen.findAllByRole('button', { name: /More actions for/ })
    expect(actions.map((button) => button.getAttribute('aria-label'))).toEqual([
      'More actions for archived title',
      'More actions for cancelled title',
    ])

    await userEvent.click(actions[0] as HTMLElement)
    const menu = await screen.findByRole('menu', { name: 'Actions for archived title' })
    const items = within(menu).getAllByRole('menuitem')

    expect(within(menu).getByRole('separator')).toBeTruthy()
    expect(items.at(-1)?.textContent).toBe('Delete task permanently…')
    expect(screen.queryByRole('button', { name: /More actions for failed/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /More actions for active/ })).toBeNull()
  })

  it('requires the exact title, prevents a second request, clears caches, and leaves the deleted route — AC-1807, AC-1808', async () => {
    const pending = Promise.withResolvers<void>()
    deleteTask.mockReturnValue(pending.promise)
    const { client, history } = draw(
      [task('archived', 'archived', { title: 'Remove old task' })],
      ['archived'],
      '/tasks/archived/files',
    )
    client.setQueryData(queryKeys.task('archived'), { task: { id: 'archived' } })

    await userEvent.click(
      await screen.findByRole('button', { name: 'More actions for Remove old task' }),
    )
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete task permanently…' }))

    const dialog = await screen.findByRole('dialog', {
      name: 'Delete Remove old task permanently',
    })
    const confirmation = within(dialog).getByLabelText('Type “Remove old task” to confirm')
    const submit = within(dialog).getByRole('button', { name: 'Delete permanently' })
    expect(submit.hasAttribute('disabled')).toBe(true)

    await userEvent.type(confirmation, 'Remove old')
    expect(submit.hasAttribute('disabled')).toBe(true)
    await userEvent.type(confirmation, ' task')
    await userEvent.click(submit)

    expect(deleteTask).toHaveBeenCalledTimes(1)
    expect(within(dialog).getByRole('button', { name: 'Deleting…' }).hasAttribute('disabled')).toBe(
      true,
    )
    await userEvent.click(within(dialog).getByRole('button', { name: 'Deleting…' }))
    expect(deleteTask).toHaveBeenCalledTimes(1)

    pending.resolve()
    await waitFor(() => expect(history.at(-1)).toBe('/'))
    expect(screen.queryByRole('link', { name: /Remove old task/ })).toBeNull()
    expect(client.getQueryData(queryKeys.tasks)).toEqual({ tasks: [] })
    expect(client.getQueryData(queryKeys.attention)).toEqual({ items: [] })
    expect(client.getQueryData(queryKeys.task('archived'))).toBeUndefined()
  })

  it('keeps the confirmation and explains a failed deletion', async () => {
    deleteTask.mockRejectedValue(new Error('network down'))
    draw([task('archived', 'archived', { title: 'Keep on failure' })])

    await userEvent.click(
      await screen.findByRole('button', { name: 'More actions for Keep on failure' }),
    )
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete task permanently…' }))
    await userEvent.type(
      await screen.findByLabelText('Type “Keep on failure” to confirm'),
      'Keep on failure',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))

    expect(await screen.findByText('Task deletion failed')).toBeTruthy()
    expect(screen.getByRole('dialog', { name: 'Delete Keep on failure permanently' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Keep on failure/ })).toBeTruthy()
  })
})
