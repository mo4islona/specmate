import { describe, expect, test } from 'vitest'
import { DEFAULT_MODEL_BINDINGS, resolveModelBindings } from '../src/models.ts'
import { AGENT_ROLES } from '../src/roles.ts'

describe('resolveModelBindings', () => {
  test('full override wins for every role', () => {
    const override = Object.fromEntries(
      AGENT_ROLES.map((role) => [role, { model: 'claude-fable-5', reasoningEffort: 'low' }]),
    )
    const bindings = resolveModelBindings({}, override)

    for (const role of AGENT_ROLES) {
      expect(bindings[role]).toEqual({ model: 'claude-fable-5', reasoningEffort: 'low' })
    }
  })

  test('partial override falls back to the passed-in defaults for the rest', () => {
    const defaults = Object.fromEntries(
      AGENT_ROLES.map((role) => [role, { model: 'claude-sonnet-5', reasoningEffort: 'medium' }]),
    )
    const bindings = resolveModelBindings(defaults, {
      implementer: { model: 'claude-fable-5', reasoningEffort: 'max' },
    })

    expect(bindings.implementer).toEqual({ model: 'claude-fable-5', reasoningEffort: 'max' })
    expect(bindings.reviewer).toEqual({ model: 'claude-sonnet-5', reasoningEffort: 'medium' })
  })

  test('a field-only override inherits the other field from the current default, not the factory default', () => {
    const defaults = Object.fromEntries(
      AGENT_ROLES.map((role) => [role, { model: 'claude-sonnet-5', reasoningEffort: 'medium' }]),
    )

    const modelOnly = resolveModelBindings(defaults, { implementer: { model: 'claude-fable-5' } })
    expect(modelOnly.implementer).toEqual({ model: 'claude-fable-5', reasoningEffort: 'medium' })

    const effortOnly = resolveModelBindings(defaults, { implementer: { reasoningEffort: 'max' } })
    expect(effortOnly.implementer).toEqual({ model: 'claude-sonnet-5', reasoningEffort: 'max' })
  })

  test('empty override keeps the passed-in defaults', () => {
    const defaults = Object.fromEntries(
      AGENT_ROLES.map((role) => [
        role,
        { model: 'claude-haiku-4-5-20251001', reasoningEffort: 'low' },
      ]),
    )
    const bindings = resolveModelBindings(defaults, {})

    for (const role of AGENT_ROLES) {
      expect(bindings[role]).toEqual({ model: 'claude-haiku-4-5-20251001', reasoningEffort: 'low' })
    }
  })

  test('a role missing from defaults falls back to DEFAULT_MODEL_BINDINGS for both fields', () => {
    const bindings = resolveModelBindings({
      implementer: { model: 'claude-fable-5', reasoningEffort: 'max' },
    })

    expect(bindings.implementer).toEqual({ model: 'claude-fable-5', reasoningEffort: 'max' })
    expect(bindings.reviewer).toEqual(DEFAULT_MODEL_BINDINGS.reviewer)
  })
})
