import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MODEL_BINDINGS,
  incoherentBindings,
  PROVIDER_MODELS,
  resolveModelBindings,
  SHIPPED_PROVIDER,
} from '../src/models.ts'
import { AGENT_ROLES, ROLE_CONTRACTS } from '../src/roles.ts'

describe('resolveModelBindings', () => {
  it('full override wins for every role', () => {
    const override = Object.fromEntries(
      AGENT_ROLES.map((role) => [role, { model: 'claude-fable-5', reasoningEffort: 'low' }]),
    )
    const bindings = resolveModelBindings({}, override)

    for (const role of AGENT_ROLES) {
      expect(bindings[role]).toEqual({
        provider: 'claude-code',
        model: 'claude-fable-5',
        reasoningEffort: 'low',
      })
    }
  })

  it('partial override falls back to the passed-in defaults for the rest', () => {
    const defaults = Object.fromEntries(
      AGENT_ROLES.map((role) => [
        role,
        { provider: 'claude-code', model: 'claude-sonnet-5', reasoningEffort: 'medium' },
      ]),
    )
    const bindings = resolveModelBindings(defaults, {
      implementer: { model: 'claude-fable-5', reasoningEffort: 'max' },
    })

    expect(bindings.implementer).toEqual({
      provider: 'claude-code',
      model: 'claude-fable-5',
      reasoningEffort: 'max',
    })
    expect(bindings.reviewer).toEqual({
      provider: 'claude-code',
      model: 'claude-sonnet-5',
      reasoningEffort: 'medium',
    })
  })

  it('a field-only override inherits the other field from the current default, not the factory default', () => {
    const defaults = Object.fromEntries(
      AGENT_ROLES.map((role) => [
        role,
        { provider: 'claude-code', model: 'claude-sonnet-5', reasoningEffort: 'medium' },
      ]),
    )

    const modelOnly = resolveModelBindings(defaults, { implementer: { model: 'claude-fable-5' } })
    expect(modelOnly.implementer).toMatchObject({
      model: 'claude-fable-5',
      reasoningEffort: 'medium',
    })

    const effortOnly = resolveModelBindings(defaults, { implementer: { reasoningEffort: 'max' } })
    expect(effortOnly.implementer).toMatchObject({
      model: 'claude-sonnet-5',
      reasoningEffort: 'max',
    })
  })

  it('empty override keeps the passed-in defaults', () => {
    const defaults = Object.fromEntries(
      AGENT_ROLES.map((role) => [
        role,
        { provider: 'claude-code', model: 'claude-haiku-4-5-20251001', reasoningEffort: 'low' },
      ]),
    )
    const bindings = resolveModelBindings(defaults, {})

    for (const role of AGENT_ROLES) {
      expect(bindings[role]).toEqual({
        provider: 'claude-code',
        model: 'claude-haiku-4-5-20251001',
        reasoningEffort: 'low',
      })
    }
  })

  it('a role missing from defaults falls back to DEFAULT_MODEL_BINDINGS for every field', () => {
    const bindings = resolveModelBindings({
      implementer: { provider: 'claude-code', model: 'claude-fable-5', reasoningEffort: 'max' },
    })

    expect(bindings.implementer).toEqual({
      provider: 'claude-code',
      model: 'claude-fable-5',
      reasoningEffort: 'max',
    })
    expect(bindings.reviewer).toEqual(DEFAULT_MODEL_BINDINGS.reviewer)
  })

  // AC-137
  it('a provider override without a model takes a model from that provider', () => {
    const defaults = Object.fromEntries(
      AGENT_ROLES.map((role) => [
        role,
        { provider: 'claude-code', model: 'claude-sonnet-5', reasoningEffort: 'medium' },
      ]),
    )
    const bindings = resolveModelBindings(defaults, { implementer: { provider: 'codex' } })

    expect(bindings.implementer.provider).toBe('codex')
    expect(PROVIDER_MODELS.codex).toContain(bindings.implementer.model)
    expect(bindings.implementer.reasoningEffort).toBe('medium')
    expect(bindings.reviewer).toMatchObject({ provider: 'claude-code', model: 'claude-sonnet-5' })
  })

  // AC-352: a stored binding written before the provider existed reads back unchanged.
  it('a stored model without a provider keeps its model and gains the provider that offers it', () => {
    const bindings = resolveModelBindings({
      implementer: { model: 'claude-fable-5', reasoningEffort: 'low' },
    })

    expect(bindings.implementer).toEqual({
      provider: 'claude-code',
      model: 'claude-fable-5',
      reasoningEffort: 'low',
    })
  })

  it('every role resolves to a model its provider offers', () => {
    const bindings = resolveModelBindings({})

    for (const role of AGENT_ROLES) {
      const binding = bindings[role]
      expect.soft(PROVIDER_MODELS[binding.provider]).toContain(binding.model)
    }
  })
})

describe('DEFAULT_MODEL_BINDINGS', () => {
  // The shipped configured set is this provider alone, and a factory binding
  // naming another would make the Settings reset store an unhonourable
  // preference. Which provider a role prefers stays in the role catalog.
  it('binds every role to the shipped provider', () => {
    for (const role of AGENT_ROLES) {
      expect.soft(DEFAULT_MODEL_BINDINGS[role].provider).toBe(SHIPPED_PROVIDER)
      expect.soft(PROVIDER_MODELS[SHIPPED_PROVIDER]).toContain(DEFAULT_MODEL_BINDINGS[role].model)
    }
  })

  it('leaves the role catalog free to prefer another provider', () => {
    expect(ROLE_CONTRACTS.implementer.defaultProvider).not.toBe(SHIPPED_PROVIDER)
  })
})

describe('incoherentBindings', () => {
  // AC-136
  it('names the model field when a provider is paired with a model it cannot run', () => {
    expect(
      incoherentBindings({ implementer: { provider: 'codex', model: 'claude-opus-5' } }),
    ).toEqual(['implementer.model'])
  })

  it('accepts a coherent pair, and a field named without its partner', () => {
    expect(
      incoherentBindings({
        implementer: { provider: 'codex', model: 'gpt-5.6-sol' },
        reviewer: { provider: 'codex' },
        planner: { model: 'claude-opus-5' },
      }),
    ).toEqual([])
  })
})
