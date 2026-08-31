import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArtifactSummary } from '../lib/api-client.ts'
import { ArtifactsScreen } from './artifacts-screen.tsx'

const listArtifacts = vi.fn()
const getArtifact = vi.fn()

vi.mock('../lib/api-client.ts', () => ({
  listArtifacts: (...args: unknown[]) => listArtifacts(...args),
  getArtifact: (...args: unknown[]) => getArtifact(...args),
}))

const CHANGE_DIR = 'openspec/changes/spatial-only-edge-fade'

function artifact(overrides: Partial<ArtifactSummary> = {}): ArtifactSummary {
  return {
    id: 'artifact-1',
    path: `${CHANGE_DIR}/proposal.md`,
    kind: 'proposal',
    gitSha: 'abc',
    updatedAt: '2026-08-29T10:00:00.000Z',
    ...overrides,
  } as ArtifactSummary
}

function renderScreen(element: ReactElement) {
  // Retries would turn a rejected query into a hung test rather than a failing one.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(<QueryClientProvider client={client}>{element}</QueryClientProvider>)
}

/** The rail, once it has arrived, so a name there is not read off the document beside it. */
const rail = async () => within(await screen.findByRole('navigation', { name: 'Task documents' }))

const rowNames = async () =>
  (await rail())
    .getAllByRole('link')
    .map((row) => row.textContent?.replace(/\s+/g, ' ').trim() ?? '')

beforeEach(() => {
  listArtifacts.mockReset()
  getArtifact.mockReset()
  getArtifact.mockImplementation((_taskId: string, id: string) =>
    Promise.resolve({ artifact: { ...artifact({ id }), content: `# body of ${id}` } }),
  )
})

describe('Docs rail', () => {
  it('names a document by what it is, not by the file a spec convention gave it', async () => {
    listArtifacts.mockResolvedValue({
      artifacts: [
        artifact({ id: 'a-tasks', path: `${CHANGE_DIR}/tasks.md`, kind: 'tasks' }),
        artifact({ id: 'a-review', path: `${CHANGE_DIR}/review.md`, kind: 'review' }),
        artifact({ id: 'a-log', path: `${CHANGE_DIR}/decisions.md`, kind: 'decision_log' }),
      ],
    })

    renderScreen(<ArtifactsScreen taskId="task-1" />)

    expect(await rowNames()).toEqual(['Decision log', 'Tasks', 'Review'])
  })

  it('keeps the change folder off the rail entirely', async () => {
    listArtifacts.mockResolvedValue({
      artifacts: [
        artifact({ id: 'a-proposal' }),
        artifact({ id: 'a-tasks', path: `${CHANGE_DIR}/tasks.md`, kind: 'tasks' }),
      ],
    })

    renderScreen(<ArtifactsScreen taskId="task-1" />)

    expect((await rail()).queryByText(new RegExp(CHANGE_DIR))).toBeNull()
  })

  it('tells two capability specs apart by the capability, which is all that differs', async () => {
    listArtifacts.mockResolvedValue({
      artifacts: [
        artifact({ id: 'a-proposal' }),
        artifact({ id: 'a-pie', path: `${CHANGE_DIR}/specs/pie-chart/spec.md`, kind: 'spec' }),
        artifact({ id: 'a-heat', path: `${CHANGE_DIR}/specs/heatmap/spec.md`, kind: 'spec' }),
      ],
    })

    renderScreen(<ArtifactsScreen taskId="task-1" />)

    expect(await rowNames()).toEqual([
      'Proposal',
      'Specification heatmap',
      'Specification pie-chart',
    ])
  })

  it('reads in the order the documents read, not alphabetically by kind', async () => {
    listArtifacts.mockResolvedValue({
      artifacts: [
        artifact({ id: 'a-summary', path: `${CHANGE_DIR}/summary.md`, kind: 'summary' }),
        artifact({ id: 'a-proposal' }),
        artifact({ id: 'a-verify', path: `${CHANGE_DIR}/verification.md`, kind: 'verification' }),
        artifact({ id: 'a-tasks', path: `${CHANGE_DIR}/tasks.md`, kind: 'tasks' }),
        artifact({ id: 'a-log', path: `${CHANGE_DIR}/decisions.md`, kind: 'decision_log' }),
      ],
    })

    renderScreen(<ArtifactsScreen taskId="task-1" />)

    // What the owner settled binds everything under it, so it sits with the
    // proposal rather than behind the summary that closes the task.
    expect(await rowNames()).toEqual([
      'Proposal',
      'Decision log',
      'Tasks',
      'Verification',
      'Summary',
    ])
  })

  it('falls back to the file name where a kind somehow holds two documents', async () => {
    listArtifacts.mockResolvedValue({
      artifacts: [
        artifact({ id: 'a-sec', path: `${CHANGE_DIR}/review/security.md`, kind: 'review' }),
        artifact({ id: 'a-perf', path: `${CHANGE_DIR}/review/performance.md`, kind: 'review' }),
      ],
    })

    renderScreen(<ArtifactsScreen taskId="task-1" />)

    expect(await rowNames()).toEqual(['Review performance', 'Review security'])
  })
})

describe('Docs reader', () => {
  it('opens the first document rather than asking which one to open', async () => {
    listArtifacts.mockResolvedValue({
      artifacts: [
        artifact({ id: 'a-proposal' }),
        artifact({ id: 'a-tasks', path: `${CHANGE_DIR}/tasks.md`, kind: 'tasks' }),
      ],
    })

    renderScreen(<ArtifactsScreen taskId="task-1" />)

    expect(await screen.findByText('body of a-proposal')).not.toBeNull()
    expect(screen.queryByText(/select a document/i)).toBeNull()
    expect(
      (await rail()).getByRole('link', { name: 'Proposal' }).getAttribute('aria-current'),
    ).toBe('page')
  })

  it('opens the document the route names, and says where that document is kept', async () => {
    listArtifacts.mockResolvedValue({
      artifacts: [
        artifact({ id: 'a-proposal' }),
        artifact({ id: 'a-tasks', path: `${CHANGE_DIR}/tasks.md`, kind: 'tasks' }),
      ],
    })
    getArtifact.mockResolvedValue({
      artifact: {
        ...artifact({ id: 'a-tasks', path: `${CHANGE_DIR}/tasks.md`, kind: 'tasks' }),
        content: '# body of a-tasks',
      },
    })

    renderScreen(<ArtifactsScreen taskId="task-1" artifactId="a-tasks" />)

    expect(await screen.findByRole('heading', { name: 'Tasks' })).not.toBeNull()
    expect(screen.getByText(new RegExp(`${CHANGE_DIR}/tasks.md`))).not.toBeNull()
    expect((await rail()).getByRole('link', { name: 'Tasks' }).getAttribute('aria-current')).toBe(
      'page',
    )
  })

  it('says a task has no documents instead of drawing an empty rail beside an empty pane', async () => {
    listArtifacts.mockResolvedValue({ artifacts: [] })

    renderScreen(<ArtifactsScreen taskId="task-1" />)

    expect(await screen.findByText(/has not committed any documents yet/i)).not.toBeNull()
    expect(screen.queryByRole('navigation', { name: 'Task documents' })).toBeNull()
  })
})
