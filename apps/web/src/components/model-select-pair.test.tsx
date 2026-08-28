import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ModelSelectPair } from './model-select-pair.tsx'

type Props = ComponentProps<typeof ModelSelectPair>

const BASE: Props = {
  role: 'implementer',
  providers: ['claude-code', 'codex'],
  modelValue: 'claude-opus-5',
  reasoningEffortValue: 'high',
  onModelChange: () => {},
  onReasoningEffortChange: () => {},
}

function renderPair(overrides: Partial<Props> = {}) {
  return render(<ModelSelectPair {...BASE} {...overrides} />)
}

/** The list is the app's own rather than the browser's, so choosing is two clicks. */
async function choose(user: ReturnType<typeof userEvent.setup>, label: RegExp, option: string) {
  await user.click(screen.getByLabelText(label))
  await user.click(await screen.findByRole('option', { name: option }))
}

async function open(user: ReturnType<typeof userEvent.setup>, label: RegExp) {
  await user.click(screen.getByLabelText(label))
  await screen.findAllByRole('option')
}

describe('ModelSelectPair', () => {
  // AC-1809, REQ-112: the pair the API rejects is one this can no longer state —
  // the provider is the heading, and every model under it is that provider's.
  it('groups the models under the provider each belongs to', async () => {
    const user = userEvent.setup()
    renderPair()
    await open(user, /implementer model/)

    const claude = screen.getByRole('group', { name: 'Claude Code' })
    const codex = screen.getByRole('group', { name: 'Codex' })

    expect(within(claude).getByRole('option', { name: 'opus-5' })).not.toBeNull()
    expect(within(codex).getByRole('option', { name: 'gpt-5.6-sol' })).not.toBeNull()
    expect(within(claude).queryByRole('option', { name: /gpt/ })).toBeNull()
  })

  it('offers only the models of the providers this deployment runs', async () => {
    const user = userEvent.setup()
    renderPair({ providers: ['claude-code'] })
    await open(user, /implementer model/)

    expect(screen.queryByRole('group', { name: 'Codex' })).toBeNull()
    expect(screen.getAllByRole('option').map((node) => node.textContent)).toEqual([
      'opus-5',
      'sonnet-5',
      'haiku-4-5',
      'fable-5',
    ])
  })

  // `copilot` is in the provider enum and ships no models; a heading over
  // nothing is a provider the owner can neither pick nor understand.
  it('leaves out a configured provider that has no models', async () => {
    const user = userEvent.setup()
    renderPair({ providers: ['claude-code', 'copilot'] })
    await open(user, /implementer model/)

    expect(screen.queryByRole('group', { name: 'Copilot' })).toBeNull()
  })

  it('reports the model chosen, and nothing else', async () => {
    const onModelChange = vi.fn()
    const onReasoningEffortChange = vi.fn()
    const user = userEvent.setup()
    renderPair({ onModelChange, onReasoningEffortChange })

    await choose(user, /implementer model/, 'gpt-5.6-sol')

    expect(onModelChange).toHaveBeenCalledWith('gpt-5.6-sol')
    expect(onReasoningEffortChange).not.toHaveBeenCalled()
  })

  it('names the chosen model on the trigger under its vendor', () => {
    renderPair({ modelValue: 'claude-haiku-4-5-20251001' })

    const trigger = screen.getByLabelText(/implementer model/)

    expect(trigger.textContent).toContain('haiku-4-5')
    expect(trigger.textContent).toContain('Claude Code')
  })

  // REQ-1014: what the API refuses is a save naming an unconfigured provider,
  // not the reading of a row written while it was configured.
  it('still shows a stored model whose provider has since been dropped', async () => {
    const user = userEvent.setup()
    renderPair({ providers: ['claude-code'], modelValue: 'gpt-5.6-sol' })

    expect(screen.getByLabelText(/implementer model/).textContent).toContain('gpt-5.6-sol')

    await open(user, /implementer model/)
    expect(screen.getByRole('group', { name: 'Codex' })).not.toBeNull()
  })

  // A field-level override names nothing until the owner sets it.
  it('leads with "Use default" where the field is an override', async () => {
    const user = userEvent.setup()
    renderPair({ includeUseDefault: true, modelValue: '', reasoningEffortValue: '' })

    expect(screen.getByLabelText(/implementer model override/).textContent).toContain('Use default')

    await open(user, /implementer model override/)
    expect(screen.getAllByRole('option')[0]?.textContent).toBe('Use default')
  })
})
