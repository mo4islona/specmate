import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { AttentionScreen } from './attention-screen.tsx'

const listAttention = vi.hoisted(() => vi.fn())
vi.mock('../lib/api-client.ts', () => ({ listAttention }))

function item(id: string, kind: string) {
  return {
    id,
    reason: { kind, detail: `${kind} detail` },
    since: '2026-08-25T09:00:00.000Z',
    task: { id: `task-${id}`, title: `${id} title`, status: 'human_spec_gate' },
  }
}

function draw(items: ReturnType<typeof item>[]) {
  listAttention.mockResolvedValue({ items })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(
    <QueryClientProvider client={client}>
      <Router hook={memoryLocation({ path: '/attention' }).hook}>
        <AttentionScreen />
      </Router>
    </QueryClientProvider>,
  )
}

describe('AttentionScreen', () => {
  it('every card carries the mark that says it is waiting on you', async () => {
    const { container } = draw([item('gate', 'gate'), item('broke', 'failed')])

    expect(await screen.findByText('gate title')).not.toBeNull()

    const cards = container.querySelectorAll('li')
    expect(cards).toHaveLength(2)
    for (const card of cards) {
      expect.soft(card.querySelector('.dot-live.dot-halo')).not.toBeNull()
    }
  })

  it('an empty queue says so without a mark of its own', async () => {
    const { container } = draw([])

    expect(await screen.findByText('Nothing needs the owner')).not.toBeNull()
    expect(container.querySelector('.dot-live')).toBeNull()
  })
})
