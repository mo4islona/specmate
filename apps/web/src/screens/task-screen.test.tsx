import type { ModelBindings } from '@specmate/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskDetail } from '../lib/api-client.ts'
import { TaskScreen } from './task-screen.tsx'

const getTask = vi.fn()
const listEvents = vi.fn()
const listConversations = vi.fn()
const listDecisions = vi.fn()
const listArtifacts = vi.fn()

vi.mock('../lib/api-client.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api-client.ts')>()),
  getTask: (...args: unknown[]) => getTask(...args),
  listEvents: (...args: unknown[]) => listEvents(...args),
  listConversations: (...args: unknown[]) => listConversations(...args),
  listDecisions: (...args: unknown[]) => listDecisions(...args),
  listArtifacts: (...args: unknown[]) => listArtifacts(...args),
}))

const BINDINGS = {
  planner: { model: 'claude-opus-5', reasoningEffort: 'high' },
  researcher: { model: 'claude-opus-5', reasoningEffort: 'high' },
} as unknown as ModelBindings

const DETAIL = {
  task: {
    id: 'task-1',
    status: 'research',
    resumeStatus: null,
    modelBindings: BINDINGS,
    caps: {},
    budgets: { max_cost_usd: 0, max_wall_clock_minutes: 0 },
    repoUrl: 'https://example.invalid/repo',
  },
  stages: [
    {
      id: 'stage-1',
      taskId: 'task-1',
      graphId: 'graph-1',
      nodeKey: 'research',
      role: 'researcher',
      provider: 'claude-code',
      status: 'running',
      attempt: 0,
      acceptedCommit: null,
      startedAt: '2026-08-16T10:00:00.000Z',
      finishedAt: null,
      telemetry: null,
    },
  ],
  graph: {
    dag: {
      nodes: [{ kind: 'stage', key: 'research', role: 'researcher', binding: 'role_default' }],
    },
  },
  spend: { costUsd: 0, costComplete: true, agentMinutes: 0 },
} as unknown as { task: TaskDetail['task']; stages: TaskDetail['stages'] }

/** Every observer built during a render, so the test can ask what was watched. */
const observed: Element[] = []

beforeEach(() => {
  observed.length = 0
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(target: Element) {
        observed.push(target)
      }
      unobserve() {}
      disconnect() {}
    },
  )

  getTask.mockResolvedValue(DETAIL)
  listEvents.mockResolvedValue({ events: [] })
  listConversations.mockResolvedValue({ conversations: [] })
  listDecisions.mockResolvedValue({ decisions: [] })
  listArtifacts.mockResolvedValue({ artifacts: [] })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(
    <QueryClientProvider client={client}>
      <TaskScreen taskId="task-1" />
    </QueryClientProvider>,
  )
}

describe('the thread opens at its end', () => {
  /**
   * The record does not exist on the render that mounts this screen — the wait
   * is what is drawn — so anything that reaches for its box once, on mount,
   * reaches for nothing. This is that regression: the watcher that holds the
   * thread at its end while the heights arrive was never built at all.
   */
  it('watches the record for the height that arrives after it', async () => {
    renderScreen()
    const record = await screen.findByRole('list', { name: 'Task thread' })

    expect(observed).not.toHaveLength(0)
    expect(observed.some((target) => target.contains(record))).toBe(true)
  })
})
