import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import type { ArtifactSummary } from '../lib/api-client.ts'
import { StepDocuments } from './step-documents.tsx'

const getArtifact = vi.hoisted(() => vi.fn())
vi.mock('../lib/api-client.ts', () => ({ getArtifact }))

const PROPOSAL = Array.from({ length: 40 }, (_line, index) => `line ${index}`).join('\n')

function document(overrides: Partial<ArtifactSummary> = {}): ArtifactSummary {
  return {
    id: 'artifact-1',
    kind: 'proposal',
    path: 'openspec/changes/pie/proposal.md',
    gitSha: null,
    updatedAt: '2026-08-16T10:00:00.000Z',
    ...overrides,
  } as ArtifactSummary
}

function draw(documents: ArtifactSummary[], current = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(
    <QueryClientProvider client={client}>
      <Router hook={memoryLocation({ path: '/tasks/task-1' }).hook}>
        <StepDocuments taskId="task-1" documents={documents} current={current} />
      </Router>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  getArtifact.mockReset()
  getArtifact.mockImplementation((_taskId: string, artifactId: string) =>
    Promise.resolve({
      artifact: {
        id: artifactId,
        content: artifactId === 'artifact-2' ? '   ' : PROPOSAL,
      },
    }),
  )
})

describe('StepDocuments (REQ-907, REQ-913)', () => {
  test('each document reads as a file: its name, then what it is and how much of it there is', async () => {
    draw([document(), document({ id: 'artifact-2', kind: 'decision_log', path: 'x/decisions.md' })])

    expect(await screen.findByText('40 lines')).not.toBeNull()
    // A document with nothing in it says so, rather than being opened to find out.
    expect(await screen.findByText('empty')).not.toBeNull()
    // The file name leads and is set in the face every other path in the app is.
    const name = screen.getByText('proposal.md')
    expect(name.className).toContain('font-mono')
    expect(screen.getByText('decision log')).not.toBeNull()
  })

  test('a long document is clamped until the owner asks for the whole of it', async () => {
    const { container } = draw([document()])

    const open = await screen.findByRole('button', { name: /read the whole thing/i })
    expect(container.querySelector('[data-document-open] .max-h-96')).not.toBeNull()

    await userEvent.click(open)
    expect(container.querySelector('[data-document-open] .max-h-96')).toBeNull()
  })

  test('the step the task stands on opens its own document; an older step opens none', async () => {
    const { unmount } = draw([document()])
    expect(await screen.findByText(/open on Docs/)).not.toBeNull()
    unmount()

    draw([document()], false)
    expect(screen.queryByText(/open on Docs/)).toBeNull()
  })

  test('only one document is open at a time', async () => {
    draw([document(), document({ id: 'artifact-2', kind: 'decision_log', path: 'x/decisions.md' })])

    await userEvent.click(await screen.findByRole('button', { name: /decisions\.md/ }))

    const cards = screen.getAllByRole('button', { expanded: true })
    expect(cards).toHaveLength(1)
    expect(cards[0]?.textContent).toContain('decisions.md')
  })
})
