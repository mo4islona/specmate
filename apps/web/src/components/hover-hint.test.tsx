import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { HoverHint } from './hover-hint.tsx'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function hover(element: Element): void {
  act(() => {
    element.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
  })
}

describe('HoverHint', () => {
  test('a hint waits for the pointer to rest, so crossing the rail does not flicker', () => {
    render(
      <HoverHint hint="Reads the repository and writes a brief." delayMs={500}>
        <button type="button">Planning</button>
      </HoverHint>,
    )

    hover(screen.getByRole('button'))
    expect(screen.queryByRole('tooltip')).toBeNull()

    act(() => void vi.advanceTimersByTime(500))
    expect(screen.getByRole('tooltip').textContent).toBe('Reads the repository and writes a brief.')
  })

  test('it is drawn into the body, where no scrolling ancestor can crop it', () => {
    const { container } = render(
      <div style={{ overflow: 'auto' }}>
        <HoverHint hint="Yours to approve." delayMs={0}>
          <button type="button">Kickoff gate</button>
        </HoverHint>
      </div>,
    )

    hover(screen.getByRole('button'))
    act(() => void vi.advanceTimersByTime(0))

    const tip = screen.getByRole('tooltip')
    expect(container.contains(tip)).toBe(false)
    expect(document.body.contains(tip)).toBe(true)
    // Positioned against the viewport, so no ancestor's overflow applies to it.
    expect(tip.className).toContain('fixed')
    expect(tip.style.left).not.toBe('')
  })

  test('a node with nothing worth saying gets no tooltip at all', () => {
    render(
      <HoverHint hint={null}>
        <button type="button">Publish</button>
      </HoverHint>,
    )

    hover(screen.getByRole('button'))
    act(() => void vi.advanceTimersByTime(2_000))
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})
