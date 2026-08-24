import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { RepoRef } from './repo-ref.tsx'

describe('RepoRef (REQ-920)', () => {
  test('the repository is a link, not a string to be retyped', () => {
    render(<RepoRef repoUrl="git@github.com:acme/specmate.git" ref="main" />)

    const link = screen.getByRole('link', { name: 'acme/specmate' })
    expect(link.getAttribute('href')).toBe('https://github.com/acme/specmate')
    expect(screen.getByText('· main')).not.toBeNull()
  })

  test('a host with no known web scheme is named without a dead link', () => {
    render(<RepoRef repoUrl="https://git.internal/acme/specmate.git" ref="main" />)

    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('acme/specmate')).not.toBeNull()
  })

  test('a task that opened a pull request says which one, and links it', () => {
    render(
      <RepoRef
        repoUrl="https://github.com/acme/specmate"
        ref="main"
        pullRequest={{
          url: 'https://github.com/acme/specmate/pull/412',
          state: 'open',
          checksState: 'passing',
        }}
      />,
    )

    const link = screen.getByRole('link', { name: /#412/ })
    expect(link.getAttribute('href')).toBe('https://github.com/acme/specmate/pull/412')
    expect(link.getAttribute('title')).toMatch(/open/)
  })

  test('a task with no pull request shows none', () => {
    render(<RepoRef repoUrl="https://github.com/acme/specmate" ref="main" />)

    expect(screen.getAllByRole('link')).toHaveLength(1)
  })
})
