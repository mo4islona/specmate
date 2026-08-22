import { describe, expect, test } from 'vitest'
import type { CreateTaskInput } from '../lib/api-client.ts'
import { buildCreateTaskPayload, setOverrideField } from './new-task-screen.tsx'

const BASE: CreateTaskInput = {
  title: 'Fix the reorg bug',
  description: '',
  type: 'bugfix',
  repoUrl: 'https://github.com/example/repo',
  baseBranch: 'main',
}

describe('buildCreateTaskPayload', () => {
  test('a multi-paragraph request reaches the payload intact', () => {
    const request = 'Reorgs deeper than 6 blocks corrupt the balance index.\n\nFix the ingester.'

    const payload = buildCreateTaskPayload({ ...BASE, description: request })

    expect(payload.description).toBe(request)
  })

  test('a blank request reaches the payload as absent, not as an empty string', () => {
    const payload = buildCreateTaskPayload({ ...BASE, description: '   ' })

    expect(payload.description).toBeUndefined()
  })

  test('every other field passes through unchanged', () => {
    const payload = buildCreateTaskPayload(BASE)

    expect(payload).toMatchObject({
      title: BASE.title,
      type: BASE.type,
      repoUrl: BASE.repoUrl,
      baseBranch: BASE.baseBranch,
    })
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
