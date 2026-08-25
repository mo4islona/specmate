import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import * as api from '../lib/api-client.ts'
import { IntakeRail } from './intake-rail.tsx'

vi.mock('../lib/api-client.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  previewIntake: vi.fn(),
  getRepository: vi.fn(),
  probeRepository: vi.fn(),
  readReference: vi.fn(),
}))

const previewIntake = vi.mocked(api.previewIntake)
const getRepository = vi.mocked(api.getRepository)
const probeRepository = vi.mocked(api.probeRepository)
const readReference = vi.mocked(api.readReference)

const SPECMATE = 'https://github.com/example/specmate'
const PORTAL = 'https://github.com/example/portal'

type Preview = Awaited<ReturnType<typeof api.previewIntake>>
type Repository = Awaited<ReturnType<typeof api.getRepository>>

function resolved(repoUrl: string, via: string, known = true): Preview {
  return {
    repository: {
      resolved: true,
      repoUrl,
      id: `id-${repoUrl}`,
      via,
      known,
      candidates: [],
    },
    references: [],
  } as unknown as Preview
}

function unresolved(
  candidates: readonly string[],
  reason: 'ambiguous' | 'nothing-named' = 'ambiguous',
): Preview {
  return {
    repository: {
      resolved: false,
      repoUrl: null,
      id: null,
      via: null,
      known: false,
      reason,
      candidates: candidates.map((repoUrl) => ({ repoUrl, id: `id-${repoUrl}` })),
    },
    references: [],
  } as unknown as Preview
}

const HOLDINGS: Repository = {
  repository: {
    id: `id-${SPECMATE}`,
    repoUrl: SPECMATE,
    taskCount: 12,
    lastUsedAt: new Date().toISOString(),
    isDefault: true,
    baseBranch: 'main',
  },
  specConvention: {
    setting: null,
    // What a real checkout resolved on the last task that ran here.
    resolved: {
      profile: 'openspec',
      suitePath: 'openspec/specs',
      conventionNote: null,
      missingSuitePath: null,
    },
  },
  coverageWaiver: null,
  recentTasks: [
    {
      id: 'task-1',
      slug: 'earlier-work',
      title: 'Compress the pipeline',
      status: 'archived',
      createdAt: new Date().toISOString(),
    },
  ],
  memory: {
    total: 3,
    entries: [
      {
        id: 'a.md',
        name: 'a',
        description: 'The runner mounts the workspace at its host path',
        bytes: 200,
        provenance: { taskId: null, stageId: null, role: 'implementer', writtenAt: null },
        borrowedFrom: null,
      },
    ],
  },
} as unknown as Repository

/** The rail owns no state; the screen does. This is the screen, reduced to that. */
function Harness({ description = '' }: { description?: string }) {
  const [pinned, setPinned] = useState('')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return (
    <QueryClientProvider client={client}>
      <Router hook={memoryLocation({ path: '/tasks/new' }).hook}>
        <IntakeRail description={description} pinnedRepoUrl={pinned} onPin={setPinned} />
        <span data-testid="pinned">{pinned}</span>
      </Router>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ shouldAdvanceTime: true })
  previewIntake.mockResolvedValue(resolved(SPECMATE, 'request-url'))
  getRepository.mockResolvedValue(HOLDINGS)
  readReference.mockResolvedValue({ read: false, reason: 'not_found', detail: 'not found' })
})

afterEach(() => vi.useRealTimers())

describe('what the request resolves to', () => {
  it('names the repository and the rule that resolved it — AC-1900', async () => {
    render(<Harness description={`fix the redirect in ${SPECMATE}`} />)

    expect(await screen.findByText('example/specmate')).toBeTruthy()
    expect(screen.getByText('from the link in your request')).toBeTruthy()
  })

  it('links the repository out to where it lives', async () => {
    render(<Harness description={`fix ${SPECMATE}`} />)

    const link = await screen.findByRole('link', { name: 'example/specmate' })
    expect(link.getAttribute('href')).toBe(SPECMATE)
  })

  it('offers both candidates and pins the chosen one — AC-1901', async () => {
    previewIntake.mockResolvedValue(unresolved([SPECMATE, PORTAL]))
    render(<Harness description="move the portal onto the specmate pipeline" />)

    const chosen = await screen.findByRole('button', { name: 'example/portal' })
    await userEvent.click(chosen)

    expect(screen.getByTestId('pinned').textContent).toBe(PORTAL)
  })

  it('releases a choice back to what the request says — AC-1902', async () => {
    // Answers the way intake does: a chosen repository wins, and without one
    // this text stays ambiguous. Otherwise the test would be asserting against
    // a mock whose answer does not depend on the choice being made.
    previewIntake.mockImplementation(async ({ repoUrl }) =>
      repoUrl ? resolved(repoUrl, 'chosen') : unresolved([SPECMATE, PORTAL]),
    )
    render(<Harness description="move the portal onto the specmate pipeline" />)

    await userEvent.click(await screen.findByRole('button', { name: 'example/portal' }))
    expect(screen.getByTestId('pinned').textContent).toBe(PORTAL)

    await userEvent.click(await screen.findByRole('button', { name: /Release this choice/ }))

    expect(screen.getByTestId('pinned').textContent).toBe('')
    expect(await screen.findByRole('button', { name: 'example/portal' })).toBeTruthy()
  })

  it('says nothing at all when the request named no repository — AC-1903', async () => {
    // The known repositories arrive as candidates here too, and they are not
    // what this request meant. Neither they nor a warning belong on screen: the
    // owner has simply not finished writing.
    previewIntake.mockResolvedValue(unresolved([SPECMATE, PORTAL], 'nothing-named'))
    const { container } = render(<Harness description="make the retry backoff configurable" />)

    await waitFor(() => expect(previewIntake).toHaveBeenCalled())
    await waitFor(() => expect(container.querySelector('aside')).toBeNull())
    expect(screen.queryByRole('heading', { name: 'Repository' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'example/specmate' })).toBeNull()
  })

  it('still reports an issue the request carries, with no repository to report', async () => {
    previewIntake.mockResolvedValue({
      ...unresolved([], 'nothing-named'),
      references: [
        {
          kind: 'issue',
          host: 'github.com',
          owner: 'acme',
          repo: 'widgets',
          number: 9,
          url: 'https://github.com/acme/widgets/issues/9',
          explicit: true,
        },
      ],
    } as unknown as Preview)

    render(<Harness description="see https://github.com/acme/widgets/issues/9" />)

    expect(await screen.findByRole('link', { name: /#9/ })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Repository' })).toBeNull()
  })
})

describe('references', () => {
  const withIssue = {
    ...resolved(SPECMATE, 'request-url'),
    references: [
      {
        kind: 'issue',
        host: 'github.com',
        owner: 'example',
        repo: 'specmate',
        number: 412,
        url: 'https://github.com/example/specmate/issues/412',
        explicit: true,
      },
    ],
  } as unknown as Preview

  it('shows the issue with its title and state, linking out — AC-1904', async () => {
    previewIntake.mockResolvedValue(withIssue)
    readReference.mockResolvedValue({
      read: true,
      detail: {
        kind: 'issue',
        owner: 'example',
        repo: 'specmate',
        number: 412,
        title: 'Login redirect lands on the homepage',
        state: 'open',
        labels: ['bug'],
        author: 'dana',
        url: 'https://github.com/example/specmate/issues/412',
      },
    } as unknown as Awaited<ReturnType<typeof api.readReference>>)

    render(<Harness description="see issue 412" />)

    expect(await screen.findByText('Login redirect lands on the homepage')).toBeTruthy()
    expect(screen.getByText('open')).toBeTruthy()
    expect(screen.getByRole('link', { name: /412/ }).getAttribute('href')).toBe(
      'https://github.com/example/specmate/issues/412',
    )
  })

  it('keeps a written reference on screen with why it could not be read — AC-1905', async () => {
    previewIntake.mockResolvedValue(withIssue)
    readReference.mockResolvedValue({
      read: false,
      reason: 'no_credential',
      detail: 'no GitHub authorization is stored',
    } as unknown as Awaited<ReturnType<typeof api.readReference>>)

    render(<Harness description="see issue 412" />)

    expect(await screen.findByText('no GitHub authorization is stored')).toBeTruthy()
    expect(screen.getByRole('link', { name: /412/ })).toBeTruthy()
  })

  it('drops shorthand that turns out to name nothing — AC-1911', async () => {
    previewIntake.mockResolvedValue({
      ...resolved(SPECMATE, 'request-url'),
      references: [
        {
          kind: 'issue',
          host: 'github.com',
          owner: 'src',
          repo: 'thing.ts',
          number: 42,
          url: 'https://github.com/src/thing.ts/issues/42',
          explicit: false,
        },
      ],
    } as unknown as Preview)

    render(<Harness description="the file src/thing.ts#42 moved" />)

    await screen.findByText('example/specmate')
    await waitFor(() => expect(readReference).toHaveBeenCalled())
    expect(screen.queryByText(/thing\.ts/)).toBeNull()
  })
})

describe('what the repository already holds', () => {
  it('shows the convention, the memory and the history, each linking on — AC-1906', async () => {
    render(<Harness description={`fix ${SPECMATE}`} />)

    expect(await screen.findByText('openspec')).toBeTruthy()
    expect(screen.getByText('openspec/specs')).toBeTruthy()
    expect(screen.getByText('The runner mounts the workspace at its host path')).toBeTruthy()
    expect(screen.getByText('12 tasks have run here, from main.')).toBeTruthy()

    const earlier = screen.getByRole('link', { name: 'Compress the pipeline' })
    expect(earlier.getAttribute('href')).toBe('/tasks/task-1')
  })

  it('probes a repository nothing has run against rather than shrugging', async () => {
    previewIntake.mockResolvedValue(
      resolved('https://github.com/example/unseen', 'request-url', false),
    )
    probeRepository.mockResolvedValue({
      probe: { read: true, defaultBranch: 'trunk', isPrivate: false, description: null },
      specConvention: {
        profile: 'openspec',
        suitePath: 'openspec/specs',
        conventionNote: null,
        missingSuitePath: null,
      },
    } as unknown as Awaited<ReturnType<typeof api.probeRepository>>)

    render(<Harness description="work on unseen" />)

    expect(await screen.findByText('openspec')).toBeTruthy()
    expect(screen.getByText('from its tree, read just now')).toBeTruthy()
    expect(screen.getByText(/this would be the first task, from trunk/)).toBeTruthy()
    // Nothing to read for a repository that has no id here.
    expect(getRepository).not.toHaveBeenCalled()
  })

  it('falls back to what the pipeline will do when the tree cannot be read', async () => {
    previewIntake.mockResolvedValue(
      resolved('https://github.com/example/unseen', 'request-url', false),
    )
    probeRepository.mockResolvedValue({
      probe: { read: false, reason: 'no_credential' },
      specConvention: null,
    } as unknown as Awaited<ReturnType<typeof api.probeRepository>>)

    render(<Harness description="work on unseen" />)

    expect(await screen.findByText(/Could not read the tree/)).toBeTruthy()
  })
})

describe('the rail settles rather than jumps', () => {
  it('shows nothing at all before it has anything — AC-1907', () => {
    previewIntake.mockReturnValue(new Promise(() => {}))
    const { container } = render(<Harness />)

    // A skeleton says "this is arriving". Nothing is, until the owner types.
    expect.soft(within(container).queryByRole('heading', { name: 'Repository' })).toBeNull()
    expect.soft(container.querySelectorAll('.skeleton')).toHaveLength(0)
  })

  it('shows the default rather than a placeholder for an empty request — AC-1908', async () => {
    previewIntake.mockResolvedValue(resolved(SPECMATE, 'default'))
    render(<Harness />)

    expect(await screen.findByText('your default repository')).toBeTruthy()
  })

  it('keeps the previous answer on screen while a newer one is in flight — AC-1909', async () => {
    const { rerender } = render(<Harness description={`fix ${SPECMATE}`} />)
    await screen.findByText('example/specmate')

    let settle: ((value: Preview) => void) | undefined
    previewIntake.mockReturnValue(new Promise<Preview>((resolve) => (settle = resolve)))
    rerender(<Harness description={`fix ${SPECMATE} and also the portal`} />)
    await vi.advanceTimersByTimeAsync(400)

    // Still the old answer, marked as being refreshed rather than cleared.
    expect(screen.getByText('example/specmate')).toBeTruthy()
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('reading…'))

    settle?.(resolved(PORTAL, 'known-name'))
    expect(await screen.findByText('example/portal')).toBeTruthy()
  })
})
