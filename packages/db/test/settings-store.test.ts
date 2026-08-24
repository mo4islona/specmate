import { afterAll, beforeAll, describe, expect, it, test } from 'bun:test'
import { type ModelBindings, normalizeRemote } from '@specmate/core'
import {
  createDb,
  type Database,
  getModelDefaults,
  getSpecConvention,
  getSpecConventions,
  SuitePathRequiredError,
  setSpecConvention,
  updateModelDefaults,
} from '../src/index.ts'

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

describeDb('spec-conventions setting', () => {
  const repo = 'https://github.com/example/conventions-probe'
  let db: Database

  beforeAll(() => {
    db = createDb(url)
  })

  afterAll(async () => {
    try {
      await setSpecConvention(db, repo, null)
    } finally {
      await db.$client.close()
    }
  })

  it('a saved convention comes back for the repository it was set on', async () => {
    await setSpecConvention(db, repo, {
      profile: 'custom',
      suitePath: 'docs/spec',
      conventionNote: 'Numbered requirements, one file per service.',
    })

    const stored = await getSpecConvention(db, repo)

    expect(stored).toEqual({
      profile: 'custom',
      suitePath: 'docs/spec',
      conventionNote: 'Numbered requirements, one file per service.',
    })
  })

  it('the SSH and HTTPS spellings of a repository are one setting', async () => {
    await setSpecConvention(db, repo, { profile: 'openspec' })

    const viaSsh = await getSpecConvention(db, 'git@github.com:example/conventions-probe.git')

    expect(viaSsh).toEqual({ profile: 'openspec' })
  })

  it('setting one repository leaves the others alone', async () => {
    const other = 'https://github.com/example/conventions-probe-other'
    await setSpecConvention(db, repo, { profile: 'openspec' })
    await setSpecConvention(db, other, { profile: 'none' })

    try {
      const all = await getSpecConventions(db)
      expect(all[normalizeRemote(repo)]).toEqual({ profile: 'openspec' })
      expect(all[normalizeRemote(other)]).toEqual({ profile: 'none' })
    } finally {
      await setSpecConvention(db, other, null)
    }
  })

  // AC-977, and the stored value must survive the refusal untouched.
  it('a custom profile without a location is refused and changes nothing', async () => {
    await setSpecConvention(db, repo, { profile: 'openspec' })

    await expect(setSpecConvention(db, repo, { profile: 'custom' })).rejects.toBeInstanceOf(
      SuitePathRequiredError,
    )
    await expect(
      setSpecConvention(db, repo, { profile: 'custom', suitePath: '   ' }),
    ).rejects.toBeInstanceOf(SuitePathRequiredError)

    expect(await getSpecConvention(db, repo)).toEqual({ profile: 'openspec' })
  })

  // AC-978: removing returns the repository to detection, which is "no setting at all".
  it('removing a convention leaves nothing behind for that repository', async () => {
    await setSpecConvention(db, repo, { profile: 'openspec' })

    await setSpecConvention(db, repo, null)

    expect(await getSpecConvention(db, repo)).toBeUndefined()
  })
})
