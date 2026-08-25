import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './button.tsx'
import { Chip } from './chip.tsx'
import { Drawer } from './drawer.tsx'
import { Field, Input } from './field.tsx'
import { Working } from './loading.tsx'
import { Popover } from './popover.tsx'
import { LoadingState } from './query-state.tsx'

describe('Button', () => {
  it('says what it is doing and refuses a second click while it does it', async () => {
    const onClick = vi.fn()
    render(
      <Button variant="primary" pending pendingLabel="Saving…" onClick={onClick}>
        Save
      </Button>,
    )

    const button = screen.getByRole('button', { name: 'Saving…' })
    expect(button.hasAttribute('disabled')).toBe(true)

    await userEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('keeps its label when nothing is in flight', () => {
    render(<Button pendingLabel="Saving…">Save</Button>)

    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy()
  })

  // Disabled and in flight looked the same, which is what put a verb waiting on
  // the server at the 38% of a verb you cannot use.
  it('calls a click in flight busy, and a click it will not take is not', () => {
    render(
      <>
        <Button pending pendingLabel="Saving…">
          Save
        </Button>
        <Button disabled>Revoke</Button>
      </>,
    )

    expect(screen.getByRole('button', { name: 'Saving…' }).getAttribute('aria-busy')).toBe('true')
    expect(screen.getByRole('button', { name: 'Revoke' }).getAttribute('aria-busy')).toBeNull()
  })

  // A bare `<button>` inside a form submits it. Everything in this app that is
  // not a submit had to say so, and six of them did it by hand.
  it('is not a submit unless it says so', () => {
    render(
      <>
        <Button>Cancel</Button>
        <Button type="submit">Launch</Button>
      </>,
    )

    expect(screen.getByRole('button', { name: 'Cancel' }).getAttribute('type')).toBe('button')
    expect(screen.getByRole('button', { name: 'Launch' }).getAttribute('type')).toBe('submit')
  })
})

describe('LoadingState', () => {
  // The slots are hidden, so this sentence is the whole of what a wait says to
  // anyone not looking at it. A shaped pane that dropped it was silence.
  it.each(['rows', 'cards', 'document', 'code'] as const)(
    'says what it is waiting on when it waits as %s',
    (shape) => {
      render(<LoadingState title="Computing the task's diff…" shape={shape} />)

      const pane = screen.getByRole('status')

      expect.soft(pane.getAttribute('aria-busy')).toBe('true')
      expect.soft(pane.textContent).toBe("Computing the task's diff…")
    },
  )

  it('says it in words where there is no shape worth drawing', () => {
    render(<LoadingState title="Loading model defaults…" />)

    const pane = screen.getByRole('status')

    expect.soft(pane.getAttribute('aria-busy')).toBe('true')
    expect.soft(pane.textContent).toContain('Loading model defaults')
  })
})

describe('Working', () => {
  // The three dots are its own, and they keep time. Left in, the sentence read
  // `loading the whole edit……`.
  it('takes over the ellipsis the sentence was written with', () => {
    const { container } = render(<Working>loading the whole edit…</Working>)

    expect.soft(container.textContent).toBe('loading the whole edit...')
    expect.soft(container.querySelectorAll('.working-dot')).toHaveLength(3)
  })
})

describe('Chip', () => {
  it('reports both of its states through ARIA rather than through a class', () => {
    render(
      <>
        <Chip pressed>medium</Chip>
        <Chip expanded>size ⌄</Chip>
      </>,
    )

    expect(screen.getByRole('button', { name: 'medium' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'size ⌄' }).getAttribute('aria-expanded')).toBe(
      'true',
    )
  })
})

describe('Field', () => {
  it('names its control, and points at the error when there is one', () => {
    render(
      <Field label="Suite path" hint="Relative to the repository root." error="It needs a path.">
        <Input />
      </Field>,
    )

    const control = screen.getByLabelText('Suite path')
    expect(control.getAttribute('aria-invalid')).toBe('true')

    const describedBy = control.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy ?? '')?.textContent).toBe('It needs a path.')
  })

  it('leaves a sound field unmarked', () => {
    render(
      <Field label="Repository URL">
        <Input />
      </Field>,
    )

    const control = screen.getByLabelText('Repository URL')
    expect(control.getAttribute('aria-invalid')).toBeNull()
    expect(control.getAttribute('aria-describedby')).toBeNull()
  })

  // Two fields on one screen with one hard-coded id is two controls the label
  // of the first one points at.
  it('gives two unlabelled-by-id fields ids of their own', () => {
    render(
      <>
        <Field label="First">
          <Input />
        </Field>
        <Field label="Second">
          <Input />
        </Field>
      </>,
    )

    const first = screen.getByLabelText('First').getAttribute('id')
    const second = screen.getByLabelText('Second').getAttribute('id')

    expect(first).toBeTruthy()
    expect(first).not.toBe(second)
  })
})

function Menu() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Popover
        open={open}
        onDismiss={() => setOpen(false)}
        role="menu"
        label="Sizes"
        trigger={
          <Chip expanded={open} onClick={() => setOpen(!open)}>
            size
          </Chip>
        }
      >
        <span>medium</span>
      </Popover>

      <button type="button">somewhere else</button>
    </>
  )
}

describe('Popover', () => {
  it('opens from its trigger', async () => {
    render(<Menu />)
    expect(screen.queryByRole('menu')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'size' }))
    expect(screen.getByRole('menu')).toBeTruthy()
  })

  // The three hand-rolled popovers this replaces had three different answers to
  // "how do I get out of this without answering it" — and one of them had none.
  it('escape shuts it', async () => {
    render(<Menu />)

    await userEvent.click(screen.getByRole('button', { name: 'size' }))
    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('a click past it shuts it', async () => {
    render(<Menu />)

    await userEvent.click(screen.getByRole('button', { name: 'size' }))
    await userEvent.click(screen.getByRole('button', { name: 'somewhere else' }))

    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('a click inside it does not', async () => {
    render(<Menu />)

    await userEvent.click(screen.getByRole('button', { name: 'size' }))
    await userEvent.click(screen.getByText('medium'))

    expect(screen.getByRole('menu')).toBeTruthy()
  })
})

describe('Drawer', () => {
  function Sheet({ onDismiss }: { onDismiss: () => void }) {
    return (
      <Drawer open onDismiss={onDismiss} label="File diff">
        <p>the diff</p>
      </Drawer>
    )
  }

  it('names itself as a modal layer, so what it covers is not what is being read', () => {
    render(<Sheet onDismiss={vi.fn()} />)
    const drawer = screen.getByRole('dialog', { name: 'File diff' })

    expect(drawer.getAttribute('aria-modal')).toBe('true')
  })

  // The same two ways out as a popover, at the scale of the viewport. The scrim
  // is a pointer affordance and nothing else, so it is hidden from the tree and
  // the close button is what carries the verb.
  it('escape shuts it', async () => {
    const onDismiss = vi.fn()
    render(<Sheet onDismiss={onDismiss} />)

    await userEvent.keyboard('{Escape}')

    expect(onDismiss).toHaveBeenCalled()
  })

  it('its close button shuts it, and names what it closes', async () => {
    const onDismiss = vi.fn()
    render(<Sheet onDismiss={onDismiss} />)

    await userEvent.click(screen.getByRole('button', { name: 'Close file diff' }))

    expect(onDismiss).toHaveBeenCalled()
  })

  it('draws nothing at all while it is shut', () => {
    render(
      <Drawer open={false} onDismiss={vi.fn()} label="File diff">
        <p>the diff</p>
      </Drawer>,
    )

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText('the diff')).toBeNull()
  })
})
