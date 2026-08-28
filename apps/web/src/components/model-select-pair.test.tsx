import type { ProviderId } from '@specmate/core'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ComponentProps, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ModelSelectPair } from './model-select-pair.tsx'

type Props = ComponentProps<typeof ModelSelectPair>

const BASE: Props = {
  role: 'implementer',
  providers: ['claude-code', 'codex'],
  providerValue: 'claude-code',
  defaultProvider: 'claude-code',
  modelValue: 'claude-opus-5',
  reasoningEffortValue: 'high',
  onProviderChange: () => {},
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

async function options(user: ReturnType<typeof userEvent.setup>, label: RegExp) {
  await user.click(screen.getByLabelText(label))
  const listed = (await screen.findAllByRole('option')).map((node) => node.textContent)
  await user.keyboard('{Escape}')

  return listed
}

describe('ModelSelectPair', () => {
  // AC-1809, REQ-112: a pair the API rejects is one this must never present.
  it('offers only the models of the provider in force', async () => {
    const user = userEvent.setup()
    renderPair({ providerValue: 'codex', defaultProvider: 'codex', modelValue: 'gpt-5.6-sol' })

    const listed = await options(user, /implementer model/)
    expect(listed).toContain('gpt-5.6-sol')
    expect(listed.join(' ')).not.toContain('opus')
  })

  it('offers only the providers this deployment runs', async () => {
    const user = userEvent.setup()
    renderPair({ providers: ['claude-code'] })

    expect(await options(user, /implementer provider/)).toEqual(['claude-code'])
  })

  it('reports the provider chosen without touching the other two fields', async () => {
    const onProviderChange = vi.fn()
    const onModelChange = vi.fn()
    const user = userEvent.setup()
    renderPair({ onProviderChange, onModelChange })

    await choose(user, /implementer provider/, 'codex')

    expect(onProviderChange).toHaveBeenCalledWith('codex')
    expect(onModelChange).not.toHaveBeenCalled()
  })

  // AC-1913: the override control's model list follows the provider it names.
  it('follows the provider the caller re-renders with', async () => {
    function Harness() {
      const [provider, setProvider] = useState<ProviderId>('claude-code')

      return (
        <ModelSelectPair
          {...BASE}
          includeUseDefault
          providerValue={provider}
          modelValue=""
          reasoningEffortValue=""
          onProviderChange={(value) => value && setProvider(value)}
        />
      )
    }

    const user = userEvent.setup()
    render(<Harness />)

    expect((await options(user, /implementer model/)).join(' ')).toContain('opus')

    await choose(user, /implementer provider/, 'codex')

    const listed = (await options(user, /implementer model/)).join(' ')
    expect(listed).toContain('gpt-5.6-sol')
    expect(listed).not.toContain('opus')
  })

  // A field-level override names nothing until the owner sets it, and the models
  // it offers meanwhile are the ones the role will actually run under.
  it('draws its models from the default when nothing is chosen', async () => {
    const user = userEvent.setup()
    renderPair({
      includeUseDefault: true,
      providerValue: '',
      defaultProvider: 'codex',
      modelValue: '',
      reasoningEffortValue: '',
    })

    const listed = await options(user, /implementer model override/)
    expect(listed).toContain('Use default')
    expect(listed).toContain('gpt-5.6-sol')
  })
})
