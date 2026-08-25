import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import * as api from '../lib/api-client.ts'
import {
  buildCreateTaskPayload,
  type NewTaskForm,
  NewTaskScreen,
  RepositoryChoice,
  setOverrideField,
} from './new-task-screen.tsx'

vi.mock('../lib/api-client.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  previewIntake: vi.fn(),
  getRepository: vi.fn(),
  readReference: vi.fn(),
}))

const previewIntake = vi.mocked(api.previewIntake)
const SPECMATE = 'https://github.com/example/specmate'

const BASE: NewTaskForm = {
  description: 'Fix the reorg bug',
  repoUrl: '',
  baseBranch: '',
  planSize: 'auto',
  modelBindings: {},
}

describe('buildCreateTaskPayload', () => {
  it('a multi-paragraph request reaches the payload intact — AC-925', () => {
    const request = 'Reorgs deeper than 6 blocks corrupt the balance index.\n\nFix the ingester.'

    const payload = buildCreateTaskPayload({ ...BASE, description: request })

    expect(payload.description).toBe(request)
  })

  it('an untouched repository and branch reach the payload as absent — AC-1056', () => {
    const payload = buildCreateTaskPayload(BASE)

    expect(payload.repoUrl).toBeUndefined()
    expect(payload.baseBranch).toBeUndefined()
  })

  it('the screen never sends a title or a type — planning declares both', () => {
    const payload = buildCreateTaskPayload(BASE)

    expect(payload).not.toHaveProperty('title')
    expect(payload).not.toHaveProperty('type')
  })

  it('`auto` is the absence of a declared size, not a value', () => {
    expect(buildCreateTaskPayload(BASE).planSize).toBeUndefined()
  })

  it('a size the owner declared reaches the payload', () => {
    expect(buildCreateTaskPayload({ ...BASE, planSize: 'small' }).planSize).toBe('small')
  })

  it('a chosen repository is carried on the resubmit — AC-972', () => {
    const payload = buildCreateTaskPayload({ ...BASE, repoUrl: ' https://github.com/example/a ' })

    expect(payload.repoUrl).toBe('https://github.com/example/a')
  })

  it('an untouched override control reaches the payload as no override at all, not as {} — AC-948', () => {
    const payload = buildCreateTaskPayload({ ...BASE, modelBindings: {} })

    expect(payload.modelBindings).toBeUndefined()
  })

  it('overriding one role reaches the payload with only that role named — AC-948', () => {
    const payload = buildCreateTaskPayload({
      ...BASE,
      modelBindings: { implementer: { model: 'claude-fable-5' } },
    })

    expect(payload.modelBindings).toEqual({ implementer: { model: 'claude-fable-5' } })
  })

  it('an effort-only override reaches the payload without a model key for that role — AC-948', () => {
    const payload = buildCreateTaskPayload({
      ...BASE,
      modelBindings: { implementer: { reasoningEffort: 'max' } },
    })

    expect(payload.modelBindings).toEqual({ implementer: { reasoningEffort: 'max' } })
  })
})

describe('the repository choice — AC-972', () => {
  it('offers every candidate the rejection carried, marking the chosen one', () => {
    render(
      <RepositoryChoice
        candidates={['https://github.com/example/alpha', 'git@github.com:example/beta.git']}
        selected="https://github.com/example/alpha"
        onSelect={() => {}}
      />,
    )

    expect(screen.getByRole('button', { name: 'example/alpha' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect(screen.getByRole('button', { name: 'example/beta' }).getAttribute('aria-pressed')).toBe(
      'false',
    )
  })

  it('still takes a repository nothing has run against yet', () => {
    render(<RepositoryChoice candidates={[]} selected="" onSelect={() => {}} />)

    expect(screen.getByLabelText('Repository URL')).not.toBeNull()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('shows what intake said about the field', () => {
    render(
      <RepositoryChoice
        candidates={[]}
        selected=""
        detail="name the repository this work belongs to"
        onSelect={() => {}}
      />,
    )

    expect(screen.getByText('name the repository this work belongs to')).not.toBeNull()
  })
})

describe('setOverrideField', () => {
  it('setting a field on an untouched role adds just that field', () => {
    const next = setOverrideField(undefined, 'implementer', 'model', 'claude-fable-5')

    expect(next).toEqual({ implementer: { model: 'claude-fable-5' } })
  })

  it('setting a second field on an already-overridden role keeps the first', () => {
    const withModel = setOverrideField(undefined, 'implementer', 'model', 'claude-fable-5')
    const withBoth = setOverrideField(withModel, 'implementer', 'reasoningEffort', 'max')

    expect(withBoth).toEqual({ implementer: { model: 'claude-fable-5', reasoningEffort: 'max' } })
  })

  it('clearing back to "Use default" drops just that field', () => {
    const withBoth = setOverrideField(
      { implementer: { model: 'claude-fable-5', reasoningEffort: 'max' } },
      'implementer',
      'model',
      undefined,
    )

    expect(withBoth).toEqual({ implementer: { reasoningEffort: 'max' } })
  })

  it('clearing the last remaining field drops the role entirely, not an empty object', () => {
    const cleared = setOverrideField(
      { implementer: { model: 'claude-fable-5' } },
      'implementer',
      'model',
      undefined,
    )

    expect(cleared).toEqual({})
  })
})

describe('the rail beside the request — AC-1910', () => {
  it('does not move the focus or the caret when an answer arrives', async () => {
    type Preview = Awaited<ReturnType<typeof api.previewIntake>>
    let settle: ((value: Preview) => void) | undefined
    previewIntake.mockReturnValue(new Promise<Preview>((resolve) => (settle = resolve)))

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <Router hook={memoryLocation({ path: '/tasks/new' }).hook}>
          <NewTaskScreen />
        </Router>
      </QueryClientProvider>,
    )

    const field = screen.getByLabelText('Request') as HTMLTextAreaElement
    await userEvent.type(field, `fix the redirect in ${SPECMATE}`)
    field.setSelectionRange(4, 4)

    settle?.({
      repository: {
        resolved: true,
        repoUrl: SPECMATE,
        id: 'id-specmate',
        via: 'request-url',
        known: false,
        candidates: [],
      },
      references: [],
    } as unknown as Preview)
    await screen.findByText('example/specmate')

    expect(document.activeElement).toBe(field)
    expect(field.selectionStart).toBe(4)
  })
})
