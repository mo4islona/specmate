import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RoleBindings } from './role-bindings.tsx'

function renderRoles() {
  return render(
    <RoleBindings>{(role) => <button type="button">{`set ${role}`}</button>}</RoleBindings>,
  )
}

describe('RoleBindings', () => {
  it('every role gets its controls, in one row rather than one card', () => {
    renderRoles()

    expect(screen.getByRole('button', { name: 'set planner' })).not.toBeNull()
    expect(screen.getByRole('button', { name: 'set retro' })).not.toBeNull()
    expect(screen.getAllByRole('term')).toHaveLength(10)
  })

  it('says where a role runs by reading the pipeline, not a list kept by hand', () => {
    renderRoles()

    // The planner holds two nodes: it writes the brief, then the spec.
    expect(screen.getByText('Planning · Specify')).not.toBeNull()
    expect(screen.getByText('Spec review')).not.toBeNull()
  })

  it('separates the settings that change a run from the ones that change nothing', () => {
    renderRoles()

    const idle = screen.getByRole('heading', { name: 'Not scheduled today' })
    const section = idle.closest('section') as HTMLElement
    // `verifier` is declared but unscheduled since the pipeline was compressed.
    expect(within(section).getByText('Verifier')).not.toBeNull()
    expect(within(section).queryByText('Implementer')).toBeNull()
  })

  it('the answerer is outside the pipeline rather than idle — it answers questions', () => {
    renderRoles()

    const outside = screen.getByRole('heading', { name: 'Outside the pipeline' })
    const section = outside.closest('section') as HTMLElement
    expect(within(section).getByText('Answerer')).not.toBeNull()
    expect(within(section).getByText('Your questions')).not.toBeNull()
  })
})
