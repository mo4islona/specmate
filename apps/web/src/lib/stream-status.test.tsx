import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import type { StreamConnectionState } from './event-stream.ts'
import { getStreamStatus, usePublishStreamStatus, useStreamStatus } from './stream-status.ts'

function Screen({ state }: { state: StreamConnectionState }): ReactNode {
  usePublishStreamStatus(state)

  return null
}

function Shell() {
  return <span data-testid="shell">{useStreamStatus() ?? 'nothing open'}</span>
}

describe('stream status', () => {
  it('reaches the shell from the task screen that opened the stream', () => {
    const view = render(
      <>
        <Shell />
        <Screen state="connecting" />
      </>,
    )

    expect(screen.getByTestId('shell').textContent).toBe('connecting')

    view.rerender(
      <>
        <Shell />
        <Screen state="live" />
      </>,
    )
    expect(screen.getByTestId('shell').textContent).toBe('live')
  })

  it('is taken back down on the way out, so no stale reconnecting outlives the screen', () => {
    const view = render(
      <>
        <Shell />
        <Screen state="stale" />
      </>,
    )
    expect(getStreamStatus()).toBe('stale')

    view.rerender(<Shell />)
    expect(screen.getByTestId('shell').textContent).toBe('nothing open')
  })
})
