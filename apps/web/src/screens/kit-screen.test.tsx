import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ThemeProvider } from '../theme/use-theme.tsx'
import { KitScreen } from './kit-screen.tsx'

function renderKit() {
  return render(
    <ThemeProvider>
      <KitScreen />
    </ThemeProvider>,
  )
}

/**
 * The workbench is the one screen nobody opens by accident, so nothing else
 * would catch it going stale. A part removed from the kit, or one whose props
 * changed shape, fails here before anyone loads `/kit` to look at a page that
 * no longer renders.
 */
describe('KitScreen', () => {
  it('draws every part without a provider beyond the theme', () => {
    renderKit()

    expect(screen.getByRole('heading', { level: 1, name: 'The kit' })).toBeTruthy()

    for (const section of ['Buttons', 'Chips and badges', 'Fields', 'Panels and rows']) {
      expect(screen.getByRole('heading', { level: 2, name: section })).toBeTruthy()
    }
  })

  it('shows each button weight in all three of its states', () => {
    renderKit()

    // One at rest, one disabled, per weight — and `primary` again as pending.
    expect(screen.getAllByRole('button', { name: 'primary' })).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Saving…' }).hasAttribute('disabled')).toBe(true)
  })

  it('the specimens are live, not pictures of controls', async () => {
    renderKit()

    await userEvent.click(screen.getByRole('button', { name: 'open a menu' }))
    expect(screen.getByRole('menu', { name: 'A menu' })).toBeTruthy()

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
