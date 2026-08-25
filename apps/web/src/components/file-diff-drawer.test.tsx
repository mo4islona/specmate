import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FileDiffDrawer } from './file-diff-drawer.tsx'

const getFileDiff = vi.fn()

vi.mock('../lib/api-client.ts', () => ({
  getFileDiff: (...args: unknown[]) => getFileDiff(...args),
}))

function renderDrawer(element: ReactElement) {
  // Retries would turn a rejected query into a hung test rather than a failing one.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(<QueryClientProvider client={client}>{element}</QueryClientProvider>)
}

beforeEach(() => {
  getFileDiff.mockReset()
  getFileDiff.mockResolvedValue({ path: 'src/thing.ts', diff: '@@ -1 +1 @@\n-old\n+new' })
})

/**
 * The drawer is no longer how the Files surface reads a diff — every file is
 * already on it. What it still answers is a file named somewhere else in the
 * task view, which is a diff opened over the surface being read (AC-996).
 */
describe('FileDiffDrawer (REQ-916)', () => {
  it('opens one file over the surface and closes back onto it — AC-996', async () => {
    const onClose = vi.fn()
    renderDrawer(<FileDiffDrawer taskId="task-1" path="src/thing.ts" onClose={onClose} />)

    expect(await screen.findByRole('dialog', { name: 'File diff' })).toBeTruthy()
    expect(await screen.findByText('+new')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Close file diff' }))

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('stays shut, and reads nothing, while no file is named', () => {
    renderDrawer(<FileDiffDrawer taskId="task-1" path={null} onClose={vi.fn()} />)

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(getFileDiff).not.toHaveBeenCalled()
  })

  it('says so when the comparison has nothing for the file — AC-997', async () => {
    getFileDiff.mockResolvedValue({ path: 'src/thing.ts', diff: '' })
    renderDrawer(<FileDiffDrawer taskId="task-1" path="src/thing.ts" onClose={vi.fn()} />)

    expect(await screen.findByText(/has nothing for this file/)).toBeTruthy()
  })
})
