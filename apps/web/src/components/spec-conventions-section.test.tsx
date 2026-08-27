import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SpecConventionsSection } from './spec-conventions-section.tsx'

const getSpecConventions = vi.fn()
const setSpecConvention = vi.fn()
const listRepositories = vi.fn()

vi.mock('../lib/api-client.ts', () => ({
  ApiRequestError: class ApiRequestError extends Error {},
  getSpecConventions: (...args: unknown[]) => getSpecConventions(...args),
  setSpecConvention: (...args: unknown[]) => setSpecConvention(...args),
  listRepositories: (...args: unknown[]) => listRepositories(...args),
}))

function renderSection(element: ReactElement) {
  // Retries would turn a rejected query into a hung test rather than a failing one.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  return render(<QueryClientProvider client={client}>{element}</QueryClientProvider>)
}

beforeEach(() => {
  getSpecConventions.mockReset()
  setSpecConvention.mockReset()
  listRepositories.mockReset()
  listRepositories.mockResolvedValue({ repositories: [] })
  setSpecConvention.mockResolvedValue({ specConventions: {} })
})

describe('SpecConventionsSection', () => {
  it('names the repository and the convention in force — AC-975', async () => {
    getSpecConventions.mockResolvedValue({
      specConventions: {
        'github.com/example/api': { profile: 'custom', suitePath: 'docs/spec' },
      },
    })

    renderSection(<SpecConventionsSection />)

    expect(await screen.findByText('github.com/example/api')).toBeTruthy()
    expect(screen.getByText(/A suite at a path · docs\/spec/)).toBeTruthy()
  })

  // AC-979 — an empty list would read as "nothing is in force anywhere".
  it('says detection is in force when nothing is set', async () => {
    getSpecConventions.mockResolvedValue({ specConventions: {} })

    renderSection(<SpecConventionsSection />)

    expect(await screen.findByText(/No repository has one set/)).toBeTruthy()
  })

  it('saves a convention for a repository — AC-976', async () => {
    getSpecConventions.mockResolvedValue({ specConventions: {} })
    const user = userEvent.setup()

    renderSection(<SpecConventionsSection />)
    await screen.findByText(/No repository has one set/)

    await user.type(screen.getByLabelText(/Repository/), 'https://github.com/example/api')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(setSpecConvention).toHaveBeenCalledWith({
        repoUrl: 'https://github.com/example/api',
        setting: { profile: 'openspec' },
      })
    })
  })

  // AC-977: the screen refuses before the round trip and says what is missing.
  it('will not save a suite-at-a-path with no path', async () => {
    getSpecConventions.mockResolvedValue({ specConventions: {} })
    const user = userEvent.setup()

    renderSection(<SpecConventionsSection />)
    await screen.findByText(/No repository has one set/)

    await user.type(screen.getByLabelText(/Repository/), 'https://github.com/example/api')

    // The list is the app's own rather than the browser's, so choosing is two
    // clicks: the one that opens it, and the one that answers.
    await user.click(screen.getByLabelText(/Convention/))
    await user.click(await screen.findByRole('option', { name: 'A suite at a path' }))

    expect(screen.getByText(/needs the path it lives at/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true)
    expect(setSpecConvention).not.toHaveBeenCalled()
  })

  it('returns a repository to detection — AC-978', async () => {
    getSpecConventions.mockResolvedValue({
      specConventions: { 'github.com/example/api': { profile: 'openspec' } },
    })
    const user = userEvent.setup()

    renderSection(<SpecConventionsSection />)
    await user.click(await screen.findByRole('button', { name: 'Use detection' }))

    await waitFor(() => {
      expect(setSpecConvention).toHaveBeenCalledWith({
        repoUrl: 'github.com/example/api',
        setting: null,
      })
    })
  })
})
