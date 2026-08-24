import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActivityEdit } from '../lib/task-thread.ts'
import { ActivityEditBlock } from './activity-edit.tsx'

const getActivityPatch = vi.fn()

vi.mock('../lib/api-client.ts', () => ({
  getActivityPatch: (...args: unknown[]) => getActivityPatch(...args),
}))

function renderBlock(element: ReactElement) {
  // Retries would turn a rejected query into a hung test rather than a failing one.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(<QueryClientProvider client={client}>{element}</QueryClientProvider>)
}

const PREVIEW = ['@@ -41,4 +41,4 @@', ' kept', '-gone', '+arrived', ' kept too'].join('\n')

function edit(overrides: Partial<ActivityEdit> = {}): ActivityEdit {
  return {
    path: 'openspec/changes/pie-charts/specs/packaging/spec.md',
    additions: 10,
    deletions: 4,
    preview: PREVIEW,
    clamped: false,
    truncated: false,
    anchored: true,
    ...overrides,
  }
}

beforeEach(() => {
  getActivityPatch.mockReset()
})

describe('ActivityEditBlock (REQ-915)', () => {
  it('reads as the counts and the diff, under the line that named the file — AC-992', () => {
    renderBlock(<ActivityEditBlock taskId="task-1" seq={12} edit={edit()} />)

    expect(screen.getByText(/Added 10 lines, removed 4 lines/)).toBeTruthy()
    expect(screen.getByText('-gone')).toBeTruthy()
    expect(screen.getByText('+arrived')).toBeTruthy()
  })

  it('numbers the diff from the file when the edit was placed in it', () => {
    const { container } = renderBlock(<ActivityEditBlock taskId="task-1" seq={12} edit={edit()} />)
    const gutters = [...container.querySelectorAll('.diff-gutter')].map((cell) => cell.textContent)

    // The hunk header sits on no line of either file, so its own gutter is blank.
    expect(gutters).toEqual(['', '41', '42', '42', '43'])
  })

  it('says so, and drops the numbers, when the edit could not be placed', () => {
    const { container } = renderBlock(
      <ActivityEditBlock taskId="task-1" seq={12} edit={edit({ anchored: false })} />,
    )

    expect(screen.getByText(/position unknown/)).toBeTruthy()
    expect(container.querySelector('.diff-gutter')).toBeNull()
  })

  it('offers the whole edit, and fetches it only when asked — AC-993', async () => {
    getActivityPatch.mockResolvedValue({ seq: 12, patch: `${PREVIEW}\n+one more line` })

    renderBlock(<ActivityEditBlock taskId="task-1" seq={12} edit={edit({ clamped: true })} />)
    expect(getActivityPatch).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /show the whole edit/i }))

    expect(await screen.findByText('+one more line')).toBeTruthy()
    expect(getActivityPatch).toHaveBeenCalledWith('task-1', 12, expect.anything())
  })

  it('offers nothing to open when the preview is the whole edit', () => {
    renderBlock(<ActivityEditBlock taskId="task-1" seq={12} edit={edit()} />)

    expect(screen.queryByRole('button', { name: /show the whole edit/i })).toBeNull()
  })

  it('says an edit was too large to record whole rather than implying it is all here', async () => {
    getActivityPatch.mockResolvedValue({ seq: 12, patch: PREVIEW })

    renderBlock(
      <ActivityEditBlock
        taskId="task-1"
        seq={12}
        edit={edit({ clamped: true, truncated: true })}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /show the whole edit/i }))

    expect(await screen.findByText(/too large to record whole/)).toBeTruthy()
  })

  it("hands the path to the surface that opens the file's whole diff — AC-996", async () => {
    const onOpenFile = vi.fn()

    renderBlock(
      <ActivityEditBlock taskId="task-1" seq={12} edit={edit()} onOpenFile={onOpenFile} />,
    )
    await userEvent.click(screen.getByRole('button', { name: /open the file's diff/i }))

    expect(onOpenFile).toHaveBeenCalledWith('openspec/changes/pie-charts/specs/packaging/spec.md')
  })
})
