import { isTerminal } from '@specmate/core'
import {
  artifacts,
  getDefaultRepository,
  pullRequests,
  runGraphs,
  stages,
  tasks,
} from '@specmate/db'
import { createTask, taskSpend } from '@specmate/orchestrator/store'
import { and, asc, desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { ApiError } from '../errors.ts'
import { deriveTitle, resolveRepository } from '../intake.ts'
import { OWNER_ACTOR, type RouteContext } from './context.ts'
import { knownRepositories } from './known-repositories.ts'
import { CreateTask, FileDiffQuery } from './schemas.ts'
import { serializeStage } from './serialize.ts'
import { validateJson, validateQuery } from './validation.ts'

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)

  return slug || 'task'
}

/** A task: creating one, reading one, and the artifacts and diffs hanging off it. */
export function taskRoutes(ctx: RouteContext) {
  const { db, gates, workspace, requireTask, performDiffOperation, performGateAction } = ctx

  return new Hono()
    .get('/tasks', async (c) => {
      const rows = await db.select().from(tasks).orderBy(desc(tasks.createdAt)).limit(100)
      return c.json({ tasks: rows })
    })

    .post('/tasks', validator('json', validateJson(CreateTask)), async (c) => {
      const { title, description, type, repoUrl, baseBranch, planSize, modelBindings } =
        c.req.valid('json')
      const [known, defaultRepository] = await Promise.all([
        knownRepositories(db),
        getDefaultRepository(db),
      ])
      const resolution = resolveRepository({
        repoUrl,
        request: description,
        known: known.map((row) => row.repoUrl),
        defaultRepoUrl: defaultRepository?.repoUrl ?? null,
      })
      if (!resolution.resolved) {
        throw new ApiError('validation', 'the target repository could not be determined', {
          status: 400,
          fields: { repoUrl: ['name the repository this work belongs to'] },
          candidates: resolution.candidates,
        })
      }

      const taskTitle = title ?? deriveTitle(description)
      const { task } = await createTask(db, {
        slug: `${slugify(taskTitle)}-${Bun.randomUUIDv7().slice(0, 8)}`,
        title: taskTitle,
        description,
        // Provisional until planning declares what supersedes it (REQ-1306).
        type: type ?? 'feature',
        repoUrl: resolution.repoUrl,
        baseBranch,
        planSize,
        modelBindings,
      })

      return c.json({ task }, 201)
    })

    .delete('/tasks/:id', async (c) => {
      const task = await requireTask(c.req.param('id'))

      // A live task is stopped before its record goes. Cancel takes the pinned
      // graph's interrupt edge, dismisses what the task left open and frees the
      // tasks blocked on it; deleting the row underneath a run would leave the
      // orchestrator writing into a task that is no longer there.
      if (!isTerminal(task.status)) {
        await performGateAction(() => gates.cancel(task.id, OWNER_ACTOR))
      }

      await workspace.release(task.id)
      await db.delete(tasks).where(eq(tasks.id, task.id))

      return c.body(null, 204)
    })

    .get('/tasks/:id', async (c) => {
      const id = c.req.param('id')
      const task = await requireTask(id)

      // Spend and the pull request depend only on task.id, not on the
      // graph/stages lookup below, so they run alongside that sequential chain
      // rather than after it.
      const spendPromise = taskSpend(db, task.id)
      const pullRequestPromise = db
        .select({
          url: pullRequests.url,
          state: pullRequests.state,
          checksState: pullRequests.checksState,
        })
        .from(pullRequests)
        .where(eq(pullRequests.taskId, task.id))
        .orderBy(desc(pullRequests.updatedAt))
        .limit(1)

      const [graph] = await db
        .select()
        .from(runGraphs)
        .where(eq(runGraphs.taskId, task.id))
        .orderBy(desc(runGraphs.version))
        .limit(1)
      // Every version's stages, not just the newest graph's: a task whose
      // declared size swapped its profile ran its earlier stages under the
      // previous version, and those stay part of its history (AC-419).
      //
      // Ordered by graph version first: attempts are numbered per version, so
      // `(nodeKey, attempt)` repeats across a re-plan and would otherwise leave
      // which of two identical-looking rows is current up to the query plan.
      const taskStages = graph
        ? await db
            .select({ stage: stages, graphVersion: runGraphs.version })
            .from(stages)
            .innerJoin(runGraphs, eq(stages.graphId, runGraphs.id))
            .where(eq(stages.taskId, task.id))
            .orderBy(asc(runGraphs.version), asc(stages.nodeKey), asc(stages.attempt))
        : []
      const spend = await spendPromise
      const [pullRequest] = await pullRequestPromise

      return c.json({
        task,
        graph: graph ?? null,
        stages: taskStages.map((row) => ({
          ...serializeStage(row.stage),
          graphVersion: row.graphVersion,
        })),
        spend,
        pullRequest: pullRequest ?? null,
      })
    })

    .get('/tasks/:id/artifacts', async (c) => {
      const task = await requireTask(c.req.param('id'))
      const rows = await db
        .select({
          id: artifacts.id,
          path: artifacts.path,
          kind: artifacts.kind,
          gitSha: artifacts.gitSha,
          updatedAt: artifacts.updatedAt,
        })
        .from(artifacts)
        .where(eq(artifacts.taskId, task.id))
        .orderBy(asc(artifacts.kind), asc(artifacts.path))

      return c.json({ artifacts: rows })
    })

    .get('/tasks/:id/artifacts/:artifactId', async (c) => {
      const task = await requireTask(c.req.param('id'))
      const [artifact] = await db
        .select({
          id: artifacts.id,
          path: artifacts.path,
          kind: artifacts.kind,
          gitSha: artifacts.gitSha,
          updatedAt: artifacts.updatedAt,
          content: artifacts.snapshotMd,
        })
        .from(artifacts)
        .where(and(eq(artifacts.id, c.req.param('artifactId')), eq(artifacts.taskId, task.id)))
        .limit(1)
      if (!artifact) {
        throw new ApiError('not_found', 'artifact was not found', { status: 404 })
      }

      return c.json({ artifact })
    })

    .get('/tasks/:id/diff/files', async (c) => {
      const task = await requireTask(c.req.param('id'))
      const { tip, total, files } = await performDiffOperation(() => workspace.diffFiles(task))

      return c.json({ tip, total, files })
    })

    .get('/tasks/:id/diff/file', validator('query', validateQuery(FileDiffQuery)), async (c) => {
      const task = await requireTask(c.req.param('id'))
      const { path, context } = c.req.valid('query')
      const diff = await performDiffOperation(() => workspace.diffFile(task, path, context))

      return c.json({ path, diff })
    })
}
