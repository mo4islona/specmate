import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import {
  buildCreateTaskPayload,
  type NewTaskForm,
  RepositoryChoice,
  setOverrideField,
} from './new-task-screen.tsx'

const BASE: NewTaskForm = {
  description: 'Fix the reorg bug',
  repoUrl: '',
  baseBranch: '',
  modelBindings: {},
}

describe('buildCreateTaskPayload', () => {
  test('a multi-paragraph request reaches the payload intact — AC-925', () => {
    const request = 'Reorgs deeper than 6 blocks corrupt the balance index.\n\nFix the ingester.'

    const payload = buildCreateTaskPayload({ ...BASE, description: request })

    expect(payload.description).toBe(request)
  })

  test('an untouched repository and branch reach the payload as absent — AC-1056', () => {
    const payload = buildCreateTaskPayload(BASE)

    expect(payload.repoUrl).toBeUndefined()
    expect(payload.baseBranch).toBeUndefined()
  })

  test('the screen never sends a title or a type — planning declares both', () => {
    const payload = buildCreateTaskPayload(BASE)

    expect(payload).not.toHaveProperty('title')
    expect(payload).not.toHaveProperty('type')
  })

  test('a chosen repository is carried on the resubmit — AC-972', () => {
    const payload = buildCreateTaskPayload({ ...BASE, repoUrl: ' https://github.com/example/a ' })

    expect(payload.repoUrl).toBe('https://github.com/example/a')
  })

  test('an untouched override control reaches the payload as no override at all, not as {} — AC-948', () => {
    const payload = buildCreateTaskPayload({ ...BASE, modelBindings: {} })

    expect(payload.modelBindings).toBeUndefined()
  })

  test('overriding one role reaches the payload with only that role named — AC-948', () => {
    const payload = buildCreateTaskPayload({
      ...BASE,
      modelBindings: { implementer: { model: 'claude-fable-5' } },
    })

    expect(payload.modelBindings).toEqual({ implementer: { model: 'claude-fable-5' } })
  })

  test('an effort-only override reaches the payload without a model key for that role — AC-948', () => {
    const payload = buildCreateTaskPayload({
      ...BASE,
      modelBindings: { implementer: { reasoningEffort: 'max' } },
    })

    expect(payload.modelBindings).toEqual({ implementer: { reasoningEffort: 'max' } })
  })
})

describe('the repository choice — AC-972', () => {
  test('offers every candidate the rejection carried, marking the chosen one', () => {
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

  test('still takes a repository nothing has run against yet', () => {
    render(<RepositoryChoice candidates={[]} selected="" onSelect={() => {}} />)

    expect(screen.getByLabelText('Repository URL')).not.toBeNull()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  test('shows what intake said about the field', () => {
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
  test('setting a field on an untouched role adds just that field', () => {
    const next = setOverrideField(undefined, 'implementer', 'model', 'claude-fable-5')

    expect(next).toEqual({ implementer: { model: 'claude-fable-5' } })
  })

  test('setting a second field on an already-overridden role keeps the first', () => {
    const withModel = setOverrideField(undefined, 'implementer', 'model', 'claude-fable-5')
    const withBoth = setOverrideField(withModel, 'implementer', 'reasoningEffort', 'max')

    expect(withBoth).toEqual({ implementer: { model: 'claude-fable-5', reasoningEffort: 'max' } })
  })

  test('clearing back to "Use default" drops just that field', () => {
    const withBoth = setOverrideField(
      { implementer: { model: 'claude-fable-5', reasoningEffort: 'max' } },
      'implementer',
      'model',
      undefined,
    )

    expect(withBoth).toEqual({ implementer: { reasoningEffort: 'max' } })
  })

  test('clearing the last remaining field drops the role entirely, not an empty object', () => {
    const cleared = setOverrideField(
      { implementer: { model: 'claude-fable-5' } },
      'implementer',
      'model',
      undefined,
    )

    expect(cleared).toEqual({})
  })
})
