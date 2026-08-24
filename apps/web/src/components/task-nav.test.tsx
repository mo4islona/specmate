import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { TaskNav } from './task-nav.tsx'

describe('TaskNav (REQ-920)', () => {
  test('each surface is a link carrying its own count', () => {
    render(<TaskNav taskId="task-1" active="thread" fileCount={12} docCount={5} />)

    expect(screen.getByRole('link', { name: /files/i }).getAttribute('href')).toBe(
      '/tasks/task-1/files',
    )
    expect(screen.getByRole('link', { name: /docs/i }).textContent).toContain('5')
    expect(screen.getByRole('link', { name: /files/i }).textContent).toContain('12')
  })

  test('the surface being shown is marked as the current page', () => {
    render(<TaskNav taskId="task-1" active="files" fileCount={3} docCount={0} />)

    expect(screen.getByRole('link', { name: /files/i }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: /thread/i }).getAttribute('aria-current')).toBeNull()
  })

  test('a count that has not arrived is absent rather than guessed at zero', () => {
    render(<TaskNav taskId="task-1" active="thread" fileCount={null} docCount={null} />)

    expect(screen.getByRole('link', { name: /files/i }).textContent).toBe('Files')
  })

  test('every tab opens something — a placeholder is not a surface', () => {
    render(<TaskNav taskId="task-1" active="thread" fileCount={0} docCount={0} />)

    expect(screen.getAllByRole('link')).toHaveLength(3)
    expect(screen.queryByText(/guide|soon/i)).toBeNull()
  })
})
