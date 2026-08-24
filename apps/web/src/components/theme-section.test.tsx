import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_THEME_ID, THEME_STORAGE_KEY } from '../theme/themes.ts'
import { ThemeProvider } from '../theme/use-theme.tsx'
import { ThemeSection } from './theme-section.tsx'

function draw() {
  return render(
    <ThemeProvider>
      <ThemeSection />
    </ThemeProvider>,
  )
}

describe('theme section', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  it('opens on the stored theme', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'gruvbox')
    draw()

    expect(document.documentElement.dataset.theme).toBe('gruvbox')
    expect(screen.getByRole('radio', { name: /Gruvbox/ })).toHaveProperty('checked', true)
  })

  it('falls back to the default when the browser remembers a theme that is gone', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'swamp')
    draw()

    expect(document.documentElement.dataset.theme).toBe(DEFAULT_THEME_ID)
  })

  it('puts the chosen theme on the document and keeps it for the next visit', async () => {
    draw()

    await userEvent.click(screen.getByRole('radio', { name: /Dracula/ }))

    expect(document.documentElement.dataset.theme).toBe('dracula')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dracula')
    expect(screen.getByRole('radio', { name: /Dracula/ })).toHaveProperty('checked', true)
    expect(screen.getByRole('radio', { name: /One Dark Pro/ })).toHaveProperty('checked', false)
  })

  it('draws each swatch in the theme it offers', () => {
    draw()

    const option = screen.getByRole('radio', { name: /Night Owl/ }).closest('label')

    expect(option?.querySelector('[data-theme]')?.getAttribute('data-theme')).toBe('night-owl')
  })
})
