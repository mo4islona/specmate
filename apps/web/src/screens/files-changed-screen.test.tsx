import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiffFileSummary } from '../lib/api-client.ts'
import { FilesChangedScreen, StatCounts } from './files-changed-screen.tsx'

const listDiffFiles = vi.fn()
const getFileDiff = vi.fn()

vi.mock('../lib/api-client.ts', () => ({
  listDiffFiles: (...args: unknown[]) => listDiffFiles(...args),
  getFileDiff: (...args: unknown[]) => getFileDiff(...args),
}))

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

beforeEach(() => {
  listDiffFiles.mockReset()
  getFileDiff.mockReset()
  getFileDiff.mockResolvedValue({ path: 'src/thing.ts', diff: '@@ -1 +1 @@\n-old\n+new' })
})

describe('StatCounts', () => {
  it('renders additions and deletions for a text file', () => {
    const rendered = renderToStaticMarkup(
      <StatCounts file={file({ additions: 3, deletions: 1 })} />,
    )

    expect(rendered).toContain('+3')
    expect(rendered).toContain('-1')
  })

  it('labels a binary file instead of rendering null counts as zero', () => {
    const rendered = renderToStaticMarkup(
      <StatCounts file={file({ additions: null, deletions: null })} />,
    )

    expect(rendered).toContain('binary')
    expect(rendered).not.toContain('+null')
  })
})

describe('FilesChangedScreen (REQ-916)', () => {
  it('lists a specification-only task under the group that names it — AC-995', async () => {
    listDiffFiles.mockResolvedValue({
      files: [
        file({ path: 'openspec/changes/pie-charts/proposal.md', group: 'spec' }),
        file({ path: 'openspec/changes/pie-charts/design.md', group: 'spec' }),
      ],
    })

    renderScreen(<FilesChangedScreen taskId="task-1" />)

    expect(await screen.findByText(/Specification · 2/)).toBeTruthy()
    expect(screen.getByText('openspec/changes/pie-charts/proposal.md')).toBeTruthy()
    expect(screen.queryByText(/^Code/)).toBeNull()
  })

  it('keeps code and specification apart when a task has both', async () => {
    listDiffFiles.mockResolvedValue({
      files: [file(), file({ path: 'openspec/changes/x/proposal.md', group: 'spec' })],
    })

    renderScreen(<FilesChangedScreen taskId="task-1" />)

    expect(await screen.findByText(/Code · 1/)).toBeTruthy()
    expect(screen.getByText(/Specification · 1/)).toBeTruthy()
  })

  it('opens the diff as a layer and closes back onto the list — AC-996', async () => {
    listDiffFiles.mockResolvedValue({ files: [file()] })

    renderScreen(<FilesChangedScreen taskId="task-1" />)
    await userEvent.click(await screen.findByRole('button', { name: /src\/thing\.ts/ }))

    const drawer = await screen.findByRole('dialog', { name: 'File diff' })
    expect(drawer).toBeTruthy()
    expect(screen.getAllByText('src/thing.ts')).toHaveLength(2)
    expect(await screen.findByText('+new')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Close file diff' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('src/thing.ts')).toBeTruthy()
  })

  it('says so when the comparison has nothing for the file — AC-997', async () => {
    listDiffFiles.mockResolvedValue({ files: [file()] })
    getFileDiff.mockResolvedValue({ path: 'src/thing.ts', diff: '' })

    renderScreen(<FilesChangedScreen taskId="task-1" />)
    await userEvent.click(await screen.findByRole('button', { name: /src\/thing\.ts/ }))

    expect(await screen.findByText(/has nothing for this file/)).toBeTruthy()
  })

  it('shows an explicit empty state rather than a blank list — AC-945', async () => {
    listDiffFiles.mockResolvedValue({ files: [] })

    renderScreen(<FilesChangedScreen taskId="task-1" />)

    expect(await screen.findByText(/has not committed any changes yet/)).toBeTruthy()
  })
})
