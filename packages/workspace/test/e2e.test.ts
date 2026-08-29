import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { artifacts, createDb, type Database, findOrCreateRepository, tasks } from '@specmate/db'
import { eq, inArray } from 'drizzle-orm'
import { Git, mirrorKey, type StageRef, WorkspaceManager, WorkspaceService } from '../src/index.ts'
import {
  cleanupTempDirs,
  FAST_LOCKS,
  makeOrigin,
  resolveTestEnvironment,
  tempDir,
  writeFiles,
} from './fixtures.ts'

/** Every task needs a repository record now (REQ-316); tests seed one the way a launch would. */
async function repositoryIdFor(db: Database, repoUrl: string): Promise<string> {
  const repository = await findOrCreateRepository(db, { repoUrl, mirrorKey: mirrorKey(repoUrl) })

  return repository.id
}

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

describeDb('a task from provisioning to release', () => {
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

  test('walks the whole way with a restarted process at every step', async () => {
    // The suite is what makes the change folder this repository's own content, and
    // therefore what makes a stage that writes only artifacts commit at all (REQ-1707).
    const origin = await makeOrigin({
      'README.md': '# service\n',
      'src/app.ts': 'export const answer = 41\n',
      'openspec/specs/answer/spec.md': '# answer Specification\n',
    })
    const root = await tempDir('root')
    const slug = `e2e-${randomUUID().slice(0, 8)}`
    const [task] = await db
      .insert(tasks)
      .values({
        slug,
        title: 'walk the workspace end to end',
        type: 'bugfix',
        repoUrl: origin.url,
        repositoryId: await repositoryIdFor(db, origin.url),
        baseBranch: 'main',
      })
      .returning()
    if (!task) throw new Error('task insert returned no row')
    createdTaskIds.push(task.id)

    // Nothing is carried between steps but the task row and the filesystem:
    // every step builds its own manager, as a restarted orchestrator would.
    const restart = () => {
      const manager = new WorkspaceManager({ config: { root, ...FAST_LOCKS } })
      return {
        manager,
        service: new WorkspaceService(manager, db, resolveTestEnvironment),
        git: new Git(manager.config),
      }
    }
    const request = {
      taskId: task.id,
      slug,
      repoUrl: origin.url,
      baseBranch: 'main',
      image: 'specmate/runner-universal@sha256:e2e-fixture',
    }

    const provisioned = await restart().service.provision(request)
    expect(provisioned.branch).toBe(`task/${slug}`)

    const research = restart()
    const workspace = await research.service.provision(request)
    await writeFiles(workspace.path, {
      [`${workspace.changeDir}/proposal.md`]: '# Why\n\nThe answer is off by one.\n',
      [`${workspace.changeDir}/specs/answer/spec.md`]: '# spec\n',
    })
    const researchCommit = await research.service.commitStage(task.id, workspace, {
      stageId: randomUUID(),
      role: 'researcher',
      provider: 'claude-code',
      attempt: 1,
    } satisfies StageRef)
    expect(researchCommit.committed).toBe(true)

    const implement = restart()
    const reopened = await implement.service.provision(request)
    expect(reopened.path).toBe(workspace.path)
    expect(
      await readFile(join(reopened.path, reopened.changeDir, 'proposal.md'), 'utf8'),
    ).toContain('off by one')
    await writeFiles(reopened.path, {
      'src/app.ts': 'export const answer = 42\n',
      [`${reopened.changeDir}/tasks.md`]: '- [x] 1.1 fix the answer\n',
    })
    await writeFiles(reopened.path, { 'RESULT.json': '{"status":"ok"}' })
    const implementCommit = await implement.service.commitStage(task.id, reopened, {
      stageId: randomUUID(),
      role: 'implementer',
      provider: 'codex',
      attempt: 1,
    } satisfies StageRef)

    expect(implementCommit.committed).toBe(true)
    const indexed = await db.select().from(artifacts).where(eq(artifacts.taskId, task.id))
    expect(indexed.map((row) => row.kind).sort()).toEqual(['proposal', 'spec', 'tasks'])

    const committedFiles = await implement.git.run(['show', '--name-only', '--format=', 'HEAD'], {
      cwd: reopened.path,
    })
    expect(committedFiles.stdout).toContain('src/app.ts')
    expect(committedFiles.stdout).not.toContain('RESULT.json')

    const finish = restart()
    await expect(finish.service.release(task.id)).rejects.toThrow(/cannot be released/)
    await db.update(tasks).set({ status: 'archived' }).where(eq(tasks.id, task.id))
    await finish.service.release(task.id)

    expect(await stat(reopened.path).catch(() => null)).toBeNull()
    const branch = await finish.git.inMirror(reopened.mirrorPath, ['rev-parse', `task/${slug}`])
    expect(branch.stdout.trim()).toBe(
      implementCommit.committed ? implementCommit.commit : 'unreachable',
    )
    // The base branch never moved while all of this happened.
    expect(await origin.head()).not.toBe(branch.stdout.trim())
  })
})
