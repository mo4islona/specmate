import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { HoverHint } from './hover-hint.tsx'

describe('HoverHint', () => {
  it('a hint waits for the pointer to rest, so crossing the rail does not flicker', async () => {
    const user = userEvent.setup()

    render(
      <HoverHint hint="Reads the repository and writes a brief." delayMs={500}>
        <button type="button">Planning</button>
      </HoverHint>,
    )

    await user.hover(screen.getByRole('button'))
    expect(screen.queryByRole('tooltip')).toBeNull()

    // Resting is what shows it; `findBy` is what waits out the delay without
    // this test having to know how the engine counts it.
    const tip = await screen.findByRole('tooltip', {}, { timeout: 2_000 })
    expect(tip.textContent).toBe('Reads the repository and writes a brief.')
  })

  it('is drawn into the body, where no scrolling ancestor can crop it', async () => {
    const user = userEvent.setup()

    const { container } = render(
      <div style={{ overflow: 'auto' }}>
        <HoverHint hint="Yours to approve." delayMs={0}>
          <button type="button">Kickoff gate</button>
        </HoverHint>
      </div>,
    )

    await user.hover(screen.getByRole('button'))

    const tip = await screen.findByRole('tooltip', {}, { timeout: 2_000 })
    expect(container.contains(tip)).toBe(false)
    expect(document.body.contains(tip)).toBe(true)
  })

  it('shows at once on focus, since arriving by keyboard is already deliberate', async () => {
    const user = userEvent.setup()

    render(
      <HoverHint hint="Yours to approve." delayMs={5_000}>
        <button type="button">Kickoff gate</button>
      </HoverHint>,
    )

    await user.tab()

    expect(await screen.findByRole('tooltip', {}, { timeout: 2_000 })).toBeTruthy()
  })

  it('a node with nothing worth saying gets no tooltip at all', async () => {
    const user = userEvent.setup()

    render(
      <HoverHint hint={null}>
        <button type="button">Publish</button>
      </HoverHint>,
    )

    await user.hover(screen.getByRole('button'))

    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})
