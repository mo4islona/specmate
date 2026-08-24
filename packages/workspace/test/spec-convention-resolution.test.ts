import { randomUUID } from 'node:crypto'
import { createDb, type Database, setSpecConvention, tasks } from '@specmate/db'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WorkspaceService } from '../src/service.ts'
import { cleanupTempDirs, makeManager, makeOrigin, resolveTestEnvironment } from './fixtures.ts'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

const IMAGE = 'ghcr.io/specmate/runner@sha256:test'

const OPENSPEC_TREE = {
  'README.md': '# origin\n',
  'openspec/specs/task-lifecycle/spec.md': '# Task lifecycle\n',
}

const CUSTOM_TREE = {
  'README.md': '# origin\n',
  'docs/spec/overview.md': '# Overview\n',
}

/**
 * Provisioning is where the tree and the owner's setting meet (REQ-1702), so this is
 * the only place the resolution can be checked end to end.
 */
describeDb('spec convention resolved at provisioning', () => {
  let db: Database
  const createdTaskIds: string[] = []
  const touchedRepos: string[] = []

  beforeAll(() => {
    db = createDb(url)
  })

  afterAll(async () => {
    for (const repoUrl of touchedRepos) {
      await setSpecConvention(db, repoUrl, null)
    }
    if (createdTaskIds.length > 0) {
      await db.delete(tasks).where(inArray(tasks.id, createdTaskIds))
    }
    await cleanupTempDirs()
  })

  async function provisionAgainst(files: Record<string, string>) {
    const origin = await makeOrigin(files)
    const { manager } = await makeManager()
    const slug = `conventions-${randomUUID().slice(0, 8)}`

    const [task] = await db
      .insert(tasks)
      .values({
        slug,
        title: 'spec convention fixture',
        type: 'feature',
        repoUrl: origin.url,
        baseBranch: 'main',
      })
      .returning()
    if (!task) throw new Error('task insert returned no row')

    createdTaskIds.push(task.id)
    touchedRepos.push(origin.url)

    const service = new WorkspaceService(manager, db, resolveTestEnvironment)

    return {
      origin,
      task,
      async provision() {
        await service.provision({
          taskId: task.id,
          slug,
          repoUrl: origin.url,
          baseBranch: 'main',
          image: IMAGE,
        })

        const [row] = await db
          .select({ specConvention: tasks.specConvention })
          .from(tasks)
          .where(eq(tasks.id, task.id))
          .limit(1)

        return row?.specConvention ?? null
      },
    }
  }

  it('a repository with a living OpenSpec suite resolves to openspec', async () => {
    const fixture = await provisionAgainst(OPENSPEC_TREE)

    const convention = await fixture.provision()

    expect(convention).toEqual({
      profile: 'openspec',
      suitePath: 'openspec/specs',
      conventionNote: null,
      missingSuitePath: null,
    })
  })

  it('a repository with nothing recognisable resolves to none', async () => {
    const fixture = await provisionAgainst({ 'README.md': '# origin\n' })

    const convention = await fixture.provision()

    expect(convention?.profile).toBe('none')
    expect(convention?.suitePath).toBeNull()
    expect(convention?.missingSuitePath).toBeNull()
  })

  // AC-1705 and AC-1706: provisioning runs before every stage, so a setting the owner
  // changes between two stages is what the next one runs under.
  it("the owner's setting overrides detection on the next provision", async () => {
    const fixture = await provisionAgainst(CUSTOM_TREE)

    expect((await fixture.provision())?.profile).toBe('none')

    await setSpecConvention(db, fixture.origin.url, {
      profile: 'custom',
      suitePath: 'docs/spec',
      conventionNote: 'One file per subsystem.',
    })

    expect(await fixture.provision()).toEqual({
      profile: 'custom',
      suitePath: 'docs/spec',
      conventionNote: 'One file per subsystem.',
      missingSuitePath: null,
    })
  })

  // AC-1702: the task proceeds, and the path that was looked for survives.
  it('a configured suite the tree does not hold resolves to none and names the path', async () => {
    const fixture = await provisionAgainst({ 'README.md': '# origin\n' })
    await setSpecConvention(db, fixture.origin.url, {
      profile: 'custom',
      suitePath: 'docs/spec',
    })

    const convention = await fixture.provision()

    expect(convention?.profile).toBe('none')
    expect(convention?.missingSuitePath).toBe('docs/spec')
  })
})
