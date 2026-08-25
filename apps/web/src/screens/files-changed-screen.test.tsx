import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiffFileSummary } from '../lib/api-client.ts'
import { FilesChangedScreen } from './files-changed-screen.tsx'

const listDiffFiles = vi.fn()
const getFileDiff = vi.fn()
const getWholeFileDiff = vi.fn()

vi.mock('../lib/api-client.ts', () => ({
  listDiffFiles: (...args: unknown[]) => listDiffFiles(...args),
  getFileDiff: (...args: unknown[]) => getFileDiff(...args),
  getWholeFileDiff: (...args: unknown[]) => getWholeFileDiff(...args),
}))

const TIP = '1111111111111111111111111111111111111111'
const NEXT_TIP = '2222222222222222222222222222222222222222'

function file(overrides: Partial<DiffFileSummary> = {}): DiffFileSummary {
  return {
    path: 'src/thing.ts',
    status: 'modified',
    group: 'code',
    additions: 3,
    deletions: 1,
    ...overrides,
  }
}

function renderScreen(element: ReactElement) {
  // Retries would turn a rejected query into a hung test rather than a failing one.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(<QueryClientProvider client={client}>{element}</QueryClientProvider>)
}

/** The tree, so a path there is not confused with the same path on its card. */
const tree = () => within(screen.getByRole('navigation', { name: 'Changed files' }))

/** One file's own tick, since a stack of cards carries one each. */
const tick = async (path: string) =>
  within(await screen.findByRole('region', { name: path })).getByRole('checkbox', {
    name: 'Viewed',
  })

beforeEach(() => {
  localStorage.clear()
  listDiffFiles.mockReset()
  getFileDiff.mockReset()
  getWholeFileDiff.mockReset()
  getFileDiff.mockImplementation((_taskId: string, path: string) =>
    Promise.resolve({ path, diff: '@@ -1 +1 @@\n-old\n+new' }),
  )
})

afterEach(() => {
  localStorage.clear()
})

describe('FilesChangedScreen (REQ-916)', () => {
  it('shows an explicit empty state rather than a blank list — AC-945', async () => {
    listDiffFiles.mockResolvedValue({ tip: TIP, files: [] })

    renderScreen(<FilesChangedScreen taskId="task-1" />)

    expect(await screen.findByText(/has not committed any changes yet/)).toBeTruthy()
  })

  it('puts every changed file in the tree with its status and counts — AC-943', async () => {
    listDiffFiles.mockResolvedValue({
      tip: TIP,
      files: [file(), file({ path: 'src/other.ts', status: 'added', additions: 9, deletions: 0 })],
    })

    renderScreen(<FilesChangedScreen taskId="task-1" />)
    await screen.findByLabelText('Filter files')

    expect(tree().getByRole('button', { name: /thing\.ts/ })).toBeTruthy()
    expect(tree().getByRole('button', { name: /other\.ts/ })).toBeTruthy()
    expect(screen.getAllByText('+9')).not.toHaveLength(0)
    // `modified` and `added` say nothing the counts beside them have not.
    expect(screen.queryByText('added')).toBeNull()
    expect(screen.queryByText('modified')).toBeNull()
  })

  it('lists a specification-only task under the group that names it — AC-995', async () => {
    listDiffFiles.mockResolvedValue({
      tip: TIP,
      files: [
        file({ path: 'openspec/changes/pie-charts/proposal.md', group: 'spec' }),
        file({ path: 'openspec/changes/pie-charts/design.md', group: 'spec' }),
      ],
    })

    renderScreen(<FilesChangedScreen taskId="task-1" />)

    expect(await screen.findByText(/Specification · 2/)).toBeTruthy()
    expect(screen.queryByText(/^Code/)).toBeNull()
  })

  it('keeps code and specification apart when a task has both', async () => {
    listDiffFiles.mockResolvedValue({
      tip: TIP,
      files: [file(), file({ path: 'openspec/changes/x/proposal.md', group: 'spec' })],
    })

    renderScreen(<FilesChangedScreen taskId="task-1" />)

    expect(await screen.findByText(/Code · 1/)).toBeTruthy()
    expect(screen.getByText(/Specification · 1/)).toBeTruthy()
  })

  it('draws every file at once and reads only the ones that are open — AC-944', async () => {
    const paths = ['a.ts', 'b.ts', 'c.ts', 'd.ts']
    listDiffFiles.mockResolvedValue({ tip: TIP, files: paths.map((path) => file({ path })) })

    renderScreen(<FilesChangedScreen taskId="task-1" />)

    // Four cards on the surface, three of them open: the fourth is a header
    // until someone asks for it.
    expect(await screen.findByRole('button', { name: /a\.ts/, expanded: true })).toBeTruthy()
    expect(screen.getByRole('button', { name: /d\.ts/, expanded: false })).toBeTruthy()
    expect(getFileDiff.mock.calls.map((call) => call[1])).toEqual(['a.ts', 'b.ts', 'c.ts'])
  })

  it('opens the code first, whatever order the comparison came in', async () => {
    // git sorts by path, which puts a change folder above `src/` every time —
    // so the reader would land on the specification and the three cards that
    // arrive open would all be spec files.
    listDiffFiles.mockResolvedValue({
      tip: TIP,
      files: [
        file({ path: 'openspec/changes/x/proposal.md', group: 'spec' }),
        file({ path: 'openspec/changes/x/tasks.md', group: 'spec' }),
        file({ path: 'src/b.ts' }),
        file({ path: 'src/a.ts' }),
      ],
    })

    renderScreen(<FilesChangedScreen taskId="task-1" />)
    await screen.findByLabelText('Filter files')

    expect(getFileDiff.mock.calls.map((call) => call[1])).toEqual([
      'src/a.ts',
      'src/b.ts',
      'openspec/changes/x/proposal.md',
    ])
  })

  it('brings a selected file into view without displacing the others — AC-944', async () => {
    listDiffFiles.mockResolvedValue({
      tip: TIP,
      files: ['a.ts', 'b.ts', 'c.ts', 'd.ts'].map((path) => file({ path })),
    })

    renderScreen(<FilesChangedScreen taskId="task-1" />)
    await screen.findByLabelText('Filter files')
    await userEvent.click(tree().getByRole('button', { name: /d\.ts/ }))

    expect(screen.getByRole('button', { name: /d\.ts/, expanded: true })).toBeTruthy()
    // Selecting is not navigating: every other card is still on the surface.
    expect(screen.getByRole('button', { name: /a\.ts/, expanded: true })).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('narrows the tree and the diffs, and leaves the pass counting everything — AC-998', async () => {
    listDiffFiles.mockResolvedValue({
      tip: TIP,
      files: [file({ path: 'src/thing.ts' }), file({ path: 'src/other.ts' })],
    })

    renderScreen(<FilesChangedScreen taskId="task-1" />)
    await userEvent.type(await screen.findByLabelText('Filter files'), 'other')

    expect(tree().queryByRole('button', { name: /thing\.ts/ })).toBeNull()
    expect(tree().getByRole('button', { name: /other\.ts/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /thing\.ts/ })).toBeNull()
    // The pass is over the comparison, not over what the filter left showing.
    expect(screen.getByText('0 / 2')).toBeTruthy()
  })

  it('says so when a filter matches nothing', async () => {
    listDiffFiles.mockResolvedValue({ tip: TIP, files: [file()] })

    renderScreen(<FilesChangedScreen taskId="task-1" />)
    await userEvent.type(await screen.findByLabelText('Filter files'), 'nothing-like-this')

    expect(screen.getByText(/No file's path matches that/)).toBeTruthy()
  })

  it('advances the pass when a file is marked viewed — AC-999', async () => {
    listDiffFiles.mockResolvedValue({
      tip: TIP,
      files: [file({ path: 'a.ts' }), file({ path: 'b.ts' })],
    })

    renderScreen(<FilesChangedScreen taskId="task-1" />)
    await userEvent.click(await tick('a.ts'))

    expect(screen.getByText('1 / 2')).toBeTruthy()
  })

  it('carries the pass back to a comparison that has not moved', async () => {
    listDiffFiles.mockResolvedValue({ tip: TIP, files: [file({ path: 'a.ts' })] })

    const first = renderScreen(<FilesChangedScreen taskId="task-1" />)
    await userEvent.click(await tick('a.ts'))
    first.unmount()

    renderScreen(<FilesChangedScreen taskId="task-1" />)

    expect(await screen.findByText('1 / 1')).toBeTruthy()
    expect(screen.queryByText(/committed since these files were marked/)).toBeNull()
  })

  it('drops the marks and says the comparison moved — AC-1800', async () => {
    listDiffFiles.mockResolvedValue({ tip: TIP, files: [file({ path: 'a.ts' })] })

    const first = renderScreen(<FilesChangedScreen taskId="task-1" />)
    await userEvent.click(await tick('a.ts'))
    first.unmount()

    listDiffFiles.mockResolvedValue({ tip: NEXT_TIP, files: [file({ path: 'a.ts' })] })
    renderScreen(<FilesChangedScreen taskId="task-1" />)

    expect(await screen.findByText(/committed since these files were marked/)).toBeTruthy()
    expect(screen.getByText('0 / 1')).toBeTruthy()
  })

  it('clamps a diff too long to be one card, and draws the rest on request', async () => {
    const long = ['@@ -1,400 +1,400 @@', ...Array.from({ length: 400 }, (_, i) => ` line ${i}`)]
    getFileDiff.mockResolvedValue({ path: 'a.ts', diff: long.join('\n') })
    listDiffFiles.mockResolvedValue({ tip: TIP, files: [file({ path: 'a.ts' })] })

    renderScreen(<FilesChangedScreen taskId="task-1" />)

    expect(await screen.findByText(/Clamped to the first 300 of 401 lines/)).toBeTruthy()
    expect(screen.queryByText(/^line 350$/)).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Draw the rest' }))

    expect(screen.getByText(/^line 350$/)).toBeTruthy()
  })

  it('leaves a diff under the clamp alone', async () => {
    listDiffFiles.mockResolvedValue({ tip: TIP, files: [file({ path: 'a.ts' })] })

    renderScreen(<FilesChangedScreen taskId="task-1" />)

    expect(await screen.findByText('+new')).toBeTruthy()
    expect(screen.queryByText(/Clamped to the first/)).toBeNull()
  })

  it('holds the unified/split choice across visits — AC-1802', async () => {
    listDiffFiles.mockResolvedValue({ tip: TIP, files: [file({ path: 'a.ts' })] })

    const first = renderScreen(<FilesChangedScreen taskId="task-1" />)
    await userEvent.click(await screen.findByRole('button', { name: 'Split' }))
    expect(screen.getByRole('button', { name: 'Split' }).getAttribute('aria-pressed')).toBe('true')
    first.unmount()

    renderScreen(<FilesChangedScreen taskId="task-1" />)

    expect(
      (await screen.findByRole('button', { name: 'Split' })).getAttribute('aria-pressed'),
    ).toBe('true')
  })

  it('does not offer two columns where there is no width for them — AC-1802', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    )
    listDiffFiles.mockResolvedValue({ tip: TIP, files: [file({ path: 'a.ts' })] })

    renderScreen(<FilesChangedScreen taskId="task-1" />)

    expect(await screen.findByText('0 / 1')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Split' })).toBeNull()

    vi.unstubAllGlobals()
  })
})
