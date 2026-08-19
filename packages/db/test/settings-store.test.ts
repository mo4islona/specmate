import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { ModelBindings } from '@specmate/core'
import { createDb, type Database, getModelDefaults, updateModelDefaults } from '../src/index.ts'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

describeDb('model-defaults setting', () => {
  let db: Database
  let original: ModelBindings

  beforeAll(async () => {
    db = createDb(url)
    original = await getModelDefaults(db)
  })

  afterAll(async () => {
    try {
      await updateModelDefaults(db, original)
    } finally {
      await db.$client.close()
    }
  })

  test('a role default has a concrete model and reasoning effort for every role', async () => {
    expect(
      Object.values(original).every(
        (binding) =>
          typeof binding.model === 'string' && typeof binding.reasoningEffort === 'string',
      ),
    ).toBe(true)
  })

  test('a field-level update persists across a fresh connection, standing in for a process restart', async () => {
    const nextModel =
      original.implementer.model === 'claude-fable-5' ? 'claude-sonnet-5' : 'claude-fable-5'
    const nextEffort = original.reviewer.reasoningEffort === 'max' ? 'low' : 'max'
    await updateModelDefaults(db, {
      implementer: { model: nextModel },
      reviewer: { reasoningEffort: nextEffort },
    })

    const restarted = createDb(url)
    try {
      const defaults = await getModelDefaults(restarted)
      expect(defaults.implementer.model).toBe(nextModel)
      // A field not named in that role's update keeps its current value, not a fallback.
      expect(defaults.implementer.reasoningEffort).toBe(original.implementer.reasoningEffort)
      expect(defaults.reviewer.reasoningEffort).toBe(nextEffort)
      expect(defaults.reviewer.model).toBe(original.reviewer.model)
      // A role not named in the update at all keeps its current value.
      expect(defaults.researcher).toEqual(original.researcher)
    } finally {
      await restarted.$client.close()
    }
  })
})
