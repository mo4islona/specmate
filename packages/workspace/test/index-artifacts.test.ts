import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { artifacts, createDb, type Database, findOrCreateRepository, tasks } from '@specmate/db'
import { eq, inArray } from 'drizzle-orm'
import { mirrorKey, type StageRef, WorkspaceBusyError, WorkspaceService } from '../src/index.ts'
import {
  cleanupTempDirs,
  makeManager,
  makeOrigin,
  resolveTestEnvironment,
  writeFiles,
} from './fixtures.ts'

/** Every task needs a repository record now (REQ-316); tests seed one the way a launch would. */
async function repositoryIdFor(db: Database, repoUrl: string): Promise<string> {
  const repository = await findOrCreateRepository(db, { repoUrl, mirrorKey: mirrorKey(repoUrl) })

  return repository.id
}

const STAGE: StageRef = {
  stageId: '3f6f0f5e-0f1a-4a3a-9d3c-000000000003',
  role: 'researcher',
  provider: 'claude-code',
  attempt: 1,
}

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

describeDb('artifact index', () => {
  let db: Database
  const createdTaskIds: string[] = []

  beforeAll(() => {
    db = createDb(url)
  })

  afterAll(async () => {
    if (createdTaskIds.length > 0) {
      await db.delete(tasks).where(inArray(tasks.id, createdTaskIds))
    }
    await cleanupTempDirs()

    // Last, and unconditional: the cleanup above needs the connection, and
    // the next suite needs it back.
    await db.$client.close()
  })

  /**
   * A repository that keeps an OpenSpec suite, so the task pins the layout where the
   * change folder is the repository's own content and its commits carry it.
   */
  const WITH_SUITE = {
    'README.md': '# origin\n',
    'openspec/specs/thing/spec.md': '# thing Specification\n',
  }

  async function setup(files?: Record<string, string>) {
    const origin = await makeOrigin(files ?? WITH_SUITE)
    const { manager } = await makeManager()
    const slug = `wsm-${randomUUID().slice(0, 8)}`
    const [task] = await db
      .insert(tasks)
      .values({
        slug,
        title: 'workspace index fixture',
        type: 'bugfix',
        repoUrl: origin.url,
        repositoryId: await repositoryIdFor(db, origin.url),
        baseBranch: 'main',
      })
      .returning()
    if (!task) throw new Error('task insert returned no row')
    createdTaskIds.push(task.id)

    const service = new WorkspaceService(manager, db, resolveTestEnvironment)
    const workspace = await service.provision({
      taskId: task.id,
      slug,
      repoUrl: origin.url,
      baseBranch: 'main',
      image: 'specmate/runner-universal@sha256:index-fixture',
    })
    const rows = () => db.select().from(artifacts).where(eq(artifacts.taskId, task.id))
    return { task, service, workspace, rows }
  }

  test('records what a stage committed, and only recognised kinds', async () => {
    const { task, service, workspace, rows } = await setup()
    await writeFiles(workspace.path, {
      [`${workspace.changeDir}/proposal.md`]: '# why\n',
      [`${workspace.changeDir}/specs/thing/spec.md`]: '# spec\n',
      [`${workspace.changeDir}/notes.txt`]: 'scratch',
    })

    const outcome = await service.commitStage(task.id, workspace, STAGE)
    const indexed = await rows()

    expect(outcome.committed).toBe(true)
    expect(indexed.map((row) => row.kind).sort()).toEqual(['proposal', 'spec'])
    const proposal = indexed.find((row) => row.kind === 'proposal')
    expect(proposal?.path).toBe(`${workspace.changeDir}/proposal.md`)
    expect(proposal?.snapshotMd).toBe('# why\n')
    // The blob the artifact was committed at, not the commit that carried it.
    expect(proposal?.gitSha).toMatch(/^[0-9a-f]{40}$/)
    expect(proposal?.gitSha).not.toBe(outcome.committed ? outcome.commit : '')
  })

  test('follows an artifact through edits and deletion', async () => {
    const { task, service, workspace, rows } = await setup()
    await writeFiles(workspace.path, {
      [`${workspace.changeDir}/proposal.md`]: '# first\n',
      [`${workspace.changeDir}/design.md`]: '# design\n',
    })
    await service.commitStage(task.id, workspace, STAGE)
    const first = await rows()

    await writeFiles(workspace.path, { [`${workspace.changeDir}/proposal.md`]: '# second\n' })
    await rm(join(workspace.path, workspace.changeDir, 'design.md'))
    await service.commitStage(task.id, workspace, { ...STAGE, attempt: 2 })
    const second = await rows()

    expect(first.map((row) => row.kind).sort()).toEqual(['design', 'proposal'])
    expect(second.map((row) => row.kind)).toEqual(['proposal'])
    expect(second[0]?.snapshotMd).toBe('# second\n')
    expect(second[0]?.gitSha).not.toBe(first.find((row) => row.kind === 'proposal')?.gitSha)
  })

  test('indexes what a stage wrote where the repository carries nothing — AC-744, AC-745', async () => {
    // No suite in the origin, so the task pins the internal layout: its change folder is
    // excluded from commits, and the store is the only place its artifacts exist.
    const { task, service, workspace, rows } = await setup({ 'README.md': '# origin\n' })
    expect(workspace.changeDir).toBe(`.specmate/changes/${task.slug}`)

    await writeFiles(workspace.path, {
      [`${workspace.changeDir}/proposal.md`]: '# brief\n',
      [`${workspace.changeDir}/notes.txt`]: 'scratch',
    })
    const outcome = await service.commitStage(task.id, workspace, STAGE)
    const indexed = await rows()

    expect(outcome.committed).toBe(false)
    expect(indexed.map((row) => row.kind)).toEqual(['proposal'])
    expect(indexed[0]?.gitSha).toBeNull()
    expect(indexed[0]?.snapshotMd).toBe('# brief\n')
  })

  test('gives a rebuilt working tree its artifacts back — AC-746, AC-748', async () => {
    const { task, service, workspace } = await setup({ 'README.md': '# origin\n' })
    await writeFiles(workspace.path, { [`${workspace.changeDir}/proposal.md`]: '# brief\n' })
    await service.commitStage(task.id, workspace, STAGE)

    // What a failed attempt left, and a tree that no longer holds the folder at all.
    await writeFiles(workspace.path, {
      [`${workspace.changeDir}/proposal.md`]: '# half-written\n',
      [`${workspace.changeDir}/design.md`]: '# from an attempt nobody accepted\n',
    })
    await service.discard(task.id, workspace)

    const proposal = join(workspace.path, workspace.changeDir, 'proposal.md')
    expect(await readFile(proposal, 'utf8')).toBe('# brief\n')
    expect(
      await stat(join(workspace.path, workspace.changeDir, 'design.md')).catch(() => null),
    ).toBeNull()

    await rm(join(workspace.path, workspace.changeDir), { recursive: true, force: true })
    const reprovisioned = await service.provision({
      taskId: task.id,
      slug: task.slug,
      repoUrl: task.repoUrl,
      baseBranch: 'main',
      image: 'specmate/runner-universal@sha256:index-fixture',
    })

    expect(
      await readFile(join(reprovisioned.path, reprovisioned.changeDir, 'proposal.md'), 'utf8'),
    ).toBe('# brief\n')
  })

  test('refuses to release a workspace whose task is still going', async () => {
    const { task, service, workspace } = await setup()

    await expect(service.release(task.id)).rejects.toThrow(WorkspaceBusyError)
    expect(await stat(workspace.path).catch(() => null)).not.toBeNull()

    await db.update(tasks).set({ status: 'archived' }).where(eq(tasks.id, task.id))
    await service.release(task.id)

    expect(await stat(workspace.path).catch(() => null)).toBeNull()
  })
})
