import { afterAll, beforeAll, describe, expect, it, test } from 'bun:test'
import assert from 'node:assert/strict'
import { type ModelBindings, normalizeRemote } from '@specmate/core'
import { eq } from 'drizzle-orm'
import {
  createDb,
  type Database,
  findOrCreateRepository,
  getModelDefaults,
  getRepositoryByUrl,
  getSpecConvention,
  listSpecConventions,
  repositories,
  SuitePathRequiredError,
  setDefaultRepository,
  setSpecConvention,
  tasks,
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

/** The mirror key is the workspace layer's to mint; nothing here reads a path. */
function mint(repoUrl: string) {
  return { repoUrl, mirrorKey: `test-${normalizeRemote(repoUrl).replaceAll(/[^a-z0-9]+/g, '-')}` }
}

describeDb('spec-conventions setting', () => {
  const repo = 'https://github.com/example/conventions-probe'
  let db: Database

  beforeAll(() => {
    db = createDb(url)
  })

  afterAll(async () => {
    try {
      await setSpecConvention(db, mint(repo), null)
    } finally {
      await db.$client.close()
    }
  })

  it('a saved convention comes back for the repository it was set on', async () => {
    await setSpecConvention(db, mint(repo), {
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
    await setSpecConvention(db, mint(repo), { profile: 'openspec' })

    const viaSsh = await getSpecConvention(db, 'git@github.com:example/conventions-probe.git')

    expect(viaSsh).toEqual({ profile: 'openspec' })
  })

  it('setting one repository leaves the others alone', async () => {
    const other = 'https://github.com/example/conventions-probe-other'
    await setSpecConvention(db, mint(repo), { profile: 'openspec' })
    await setSpecConvention(db, mint(other), { profile: 'none' })

    try {
      const all = await listSpecConventions(db)
      expect(all[normalizeRemote(repo)]).toEqual({ profile: 'openspec' })
      expect(all[normalizeRemote(other)]).toEqual({ profile: 'none' })
    } finally {
      await setSpecConvention(db, mint(other), null)
    }
  })

  // AC-977, and the stored value must survive the refusal untouched.
  it('a custom profile without a location is refused and changes nothing', async () => {
    await setSpecConvention(db, mint(repo), { profile: 'openspec' })

    await expect(setSpecConvention(db, mint(repo), { profile: 'custom' })).rejects.toBeInstanceOf(
      SuitePathRequiredError,
    )
    await expect(
      setSpecConvention(db, mint(repo), { profile: 'custom', suitePath: '   ' }),
    ).rejects.toBeInstanceOf(SuitePathRequiredError)

    expect(await getSpecConvention(db, repo)).toEqual({ profile: 'openspec' })
  })

  // AC-978: removing returns the repository to detection, which is "no setting at all".
  it('removing a convention leaves nothing behind for that repository', async () => {
    await setSpecConvention(db, mint(repo), { profile: 'openspec' })

    await setSpecConvention(db, mint(repo), null)

    expect(await getSpecConvention(db, repo)).toBeUndefined()
  })
})

describeDb('repository records — REQ-316', () => {
  const run = crypto.randomUUID().slice(0, 8)
  const https = `https://github.com/example/record-${run}`
  const ssh = `git@github.com:example/record-${run}.git`
  let db: Database

  beforeAll(() => {
    db = createDb(url)
  })

  afterAll(async () => {
    try {
      await db.delete(repositories).where(eq(repositories.normalized, normalizeRemote(https)))
    } finally {
      await db.$client.close()
    }
  })

  it('folds two spellings of one remote into one record — AC-346', async () => {
    const first = await findOrCreateRepository(db, mint(https))
    const second = await findOrCreateRepository(db, mint(ssh))

    expect(second.id).toBe(first.id)
    // The mirror key stays the one the first record was filed under: the files
    // are already there, and the second spelling must not rename them.
    expect(second.mirrorKey).toBe(first.mirrorKey)
  })

  it('mints one record when two launches race on the same remote — AC-346, D4', async () => {
    const racing = `https://github.com/example/racing-${run}`
    try {
      const minted = await Promise.all(
        Array.from({ length: 8 }, () => findOrCreateRepository(db, mint(racing))),
      )

      expect(new Set(minted.map((row) => row.id)).size).toBe(1)
    } finally {
      await db.delete(repositories).where(eq(repositories.normalized, normalizeRemote(racing)))
    }
  })

  it('holds a record for a repository no task has named — AC-347', async () => {
    const unused = `https://github.com/example/unused-${run}`
    try {
      await setSpecConvention(db, mint(unused), { profile: 'openspec' })

      const stored = await getRepositoryByUrl(db, unused)
      expect(stored).toMatchObject({ specConvention: { profile: 'openspec' } })
    } finally {
      await db.delete(repositories).where(eq(repositories.normalized, normalizeRemote(unused)))
    }
  })

  it('leaves exactly one record the default — AC-348', async () => {
    const other = `https://github.com/example/other-default-${run}`
    try {
      await setDefaultRepository(db, mint(https))
      await setDefaultRepository(db, mint(other))

      const flagged = await db.select().from(repositories).where(eq(repositories.isDefault, true))
      expect(flagged).toHaveLength(1)
      expect(flagged[0]?.normalized).toBe(normalizeRemote(other))
    } finally {
      await setDefaultRepository(db, null)
      await db.delete(repositories).where(eq(repositories.normalized, normalizeRemote(other)))
    }
  })

  it('outlives every task against it — AC-349', async () => {
    const repository = await findOrCreateRepository(db, mint(https))
    const [task] = await db
      .insert(tasks)
      .values({
        slug: `record-task-${run}`,
        title: 'Record fixture',
        type: 'feature',
        repoUrl: https,
        repositoryId: repository.id,
      })
      .returning()
    assert(task)

    await db.delete(tasks).where(eq(tasks.id, task.id))

    expect(await getRepositoryByUrl(db, https)).toMatchObject({ id: repository.id })
  })
})
