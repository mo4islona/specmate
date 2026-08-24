import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SizePicker } from './size-picker.tsx'

describe('SizePicker', () => {
  it('carries the current value on the trigger, closed', () => {
    render(<SizePicker value="auto" onChange={() => {}} />)

    expect(screen.getByRole('button', { name: /auto/ })).not.toBeNull()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('says what each size buys, and marks the one in force', async () => {
    render(<SizePicker value="small" onChange={() => {}} />)

    await userEvent.click(screen.getByRole('button', { name: /small/ }))

    expect(screen.getByText('One iteration. No spec review, tighter caps')).not.toBeNull()
    expect(screen.getByRole('menuitemradio', { name: /small/ }).getAttribute('aria-checked')).toBe(
      'true',
    )
    expect(screen.getByRole('menuitemradio', { name: /large/ }).getAttribute('aria-checked')).toBe(
      'false',
    )
  })

  it('choosing reports the size and shuts the menu', async () => {
    const onChange = vi.fn()
    render(<SizePicker value="auto" onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: /auto/ }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: /medium/ }))

    expect(onChange).toHaveBeenCalledWith('medium')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('escape shuts the menu without choosing', async () => {
    const onChange = vi.fn()
    render(<SizePicker value="auto" onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: /auto/ }))
    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('menu')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })
})
