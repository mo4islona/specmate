import { expectedSuitePath, OPENSPEC_SUITE_PATH, resolveSpecConvention } from '@specmate/core'
import { coverageWaivers, getDefaultRepository, getSpecConvention, tasks } from '@specmate/db'
import { revokeCoverageWaiverInForce } from '@specmate/orchestrator/store'
import {
  githubRepository,
  listStore,
  type MemoryEntry,
  memoryPath,
  mirrorKey,
  type WorkspaceConfig,
} from '@specmate/workspace'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { ApiError } from '../errors.ts'
import type { RouteContext } from './context.ts'
import { knownRepositories } from './known-repositories.ts'
import { ProbeRepository } from './schemas.ts'
import { validateQuery } from './validation.ts'

/** Enough to recognise a repository at a glance; the full lists live on their own screens. */
const MEMORY_EXCERPT = 5
const RECENT_TASKS = 5

/** Undated entries sort last: a store written before provenance existed is the oldest thing in it. */
function writtenAtMs(entry: MemoryEntry): number {
  const written = entry.provenance.writtenAt
  const parsed = written ? Date.parse(written) : Number.NaN

  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed
}

/**
 * What a repository remembers, newest first, bounded. A store no stage has
 * written yet is not an error — it is a repository nothing has been learned
 * about, which is most of them.
 */
async function memoryExcerpt(
  workspaceConfig: WorkspaceConfig,
  repoUrl: string,
): Promise<{ total: number; entries: MemoryEntry[] }> {
  const entries = await listStore(memoryPath(workspaceConfig, repoUrl)).catch(() => [])
  const newestFirst = entries.toSorted((a, b) => writtenAtMs(b) - writtenAtMs(a))

  return { total: entries.length, entries: newestFirst.slice(0, MEMORY_EXCERPT) }
}

/**
 * A repository as this system knows it. The literal `/repositories/probe` is
 * registered before `/repositories/:id` on purpose — Hono matches in order, and
 * the parameterised route would otherwise take `probe` for an id.
 */
export function repositoryRoutes(ctx: RouteContext) {
  const { db, repositoryProbes, workspaceConfig } = ctx

  return (
    new Hono()
      .get('/repositories', async (c) => {
        const [repoRows, defaultRepoUrl, waiverRows] = await Promise.all([
          knownRepositories(db),
          getDefaultRepository(db),
          db
            .select({
              repoUrl: coverageWaivers.repoUrl,
              originTaskId: coverageWaivers.originTaskId,
              originTitle: tasks.title,
              acceptedAt: coverageWaivers.createdAt,
            })
            .from(coverageWaivers)
            .leftJoin(tasks, eq(coverageWaivers.originTaskId, tasks.id))
            .where(isNull(coverageWaivers.revokedAt)),
        ])
        const waiverFor = new Map(waiverRows.map((row) => [row.repoUrl, row]))
        // A default nothing has run against yet still belongs on the list — it is
        // what the next launch resolves to (REQ-1017).
        const rows =
          defaultRepoUrl && !repoRows.some((row) => row.repoUrl === defaultRepoUrl)
            ? [...repoRows, { repoUrl: defaultRepoUrl, taskCount: 0, lastUsedAt: null }]
            : repoRows

        const repositories = rows.map((row) => {
          const waiver = waiverFor.get(row.repoUrl)

          return {
            id: mirrorKey(row.repoUrl),
            repoUrl: row.repoUrl,
            taskCount: row.taskCount,
            lastUsedAt: row.lastUsedAt,
            isDefault: row.repoUrl === defaultRepoUrl,
            coverageWaiver: waiver
              ? {
                  originTaskId: waiver.originTaskId,
                  originTitle: waiver.originTitle,
                  acceptedAt: waiver.acceptedAt,
                }
              : null,
          }
        })

        return c.json({ repositories })
      })

      /** REQ-1015: the owner's way to take an acceptance back. Idempotent per repository, not per record. */
      .delete('/repositories/:id/coverage-waiver', async (c) => {
        const id = c.req.param('id')
        // One row per waived repository, so the whole set is a handful; the id is
        // a digest, which no query can invert.
        const inForce = await db
          .select({ repoUrl: coverageWaivers.repoUrl })
          .from(coverageWaivers)
          .where(isNull(coverageWaivers.revokedAt))
        const match = inForce.find((row) => mirrorKey(row.repoUrl) === id)
        const revoked = match ? await revokeCoverageWaiverInForce(db, match.repoUrl) : null
        if (!revoked) {
          throw new ApiError('not_found', 'that repository has no coverage waiver in force', {
            status: 404,
          })
        }

        return c.json({ waiver: revoked })
      })

      /**
       * Everything the system holds about one repository, in one read (REQ-1020).
       * The launch screen paints a panel from this; four reads would arrive in
       * four waves and the panel would visibly assemble itself.
       *
       * Only a repository the system knows has an id at all — the digest cannot be
       * inverted — so a repository nothing has run against is reported by the
       * preview and never reaches this route.
       */
      /**
       * What a repository nobody has run a task against turns out to be, without
       * cloning it and without a model: its default branch, and whether the
       * specification suite its setting expects is actually in the tree. The
       * answer runs through `resolveSpecConvention` — the same function
       * provisioning uses (REQ-1702) — so a forecast and what a task ends up
       * running under cannot disagree on the rules, only on the moment.
       *
       * Registered before `/repositories/:id` so the static segment wins.
       */
      .get('/repositories/probe', validator('query', validateQuery(ProbeRepository)), async (c) => {
        const { repoUrl } = c.req.valid('query')
        const slug = githubRepository(repoUrl)
        if (!slug) {
          return c.json({
            probe: { read: false as const, reason: 'unsupported_host' as const },
            specConvention: null,
          })
        }

        const [owner, repo] = slug.split('/') as [string, string]
        const setting = await getSpecConvention(db, repoUrl)
        const configured = expectedSuitePath(setting)
        const paths = [
          OPENSPEC_SUITE_PATH,
          ...(configured && configured !== OPENSPEC_SUITE_PATH ? [configured] : []),
        ]
        const read = await repositoryProbes.probe({ host: 'github.com', owner, repo, paths })
        if (!read.read) {
          return c.json({
            probe: { read: false as const, reason: read.reason },
            specConvention: null,
          })
        }

        const tree = {
          hasOpenspecSuite: read.detail.presentPaths.includes(OPENSPEC_SUITE_PATH),
          // Null where the setting expects no particular path, which is every
          // profile but the configured one.
          hasConfiguredSuite: configured ? read.detail.presentPaths.includes(configured) : null,
        }

        return c.json({
          probe: {
            read: true as const,
            defaultBranch: read.detail.defaultBranch,
            isPrivate: read.detail.isPrivate,
            description: read.detail.description,
          },
          specConvention: resolveSpecConvention(tree, setting),
        })
      })

      .get('/repositories/:id', async (c) => {
        const id = c.req.param('id')
        const [repoRows, defaultRepoUrl] = await Promise.all([
          knownRepositories(db),
          getDefaultRepository(db),
        ])
        const known = repoRows.find((row) => mirrorKey(row.repoUrl) === id)
        const repoUrl =
          known?.repoUrl ??
          (defaultRepoUrl && mirrorKey(defaultRepoUrl) === id ? defaultRepoUrl : null)
        if (!repoUrl) {
          throw new ApiError('not_found', 'no repository has that id', { status: 404 })
        }

        const [specConvention, waiver, recentTasks, memory] = await Promise.all([
          getSpecConvention(db, repoUrl),
          db
            .select({
              originTaskId: coverageWaivers.originTaskId,
              originTitle: tasks.title,
              acceptedAt: coverageWaivers.createdAt,
            })
            .from(coverageWaivers)
            .leftJoin(tasks, eq(coverageWaivers.originTaskId, tasks.id))
            .where(and(eq(coverageWaivers.repoUrl, repoUrl), isNull(coverageWaivers.revokedAt)))
            .limit(1),
          db
            .select({
              id: tasks.id,
              slug: tasks.slug,
              title: tasks.title,
              status: tasks.status,
              baseBranch: tasks.baseBranch,
              specConvention: tasks.specConvention,
              createdAt: tasks.createdAt,
            })
            .from(tasks)
            .where(eq(tasks.repoUrl, repoUrl))
            .orderBy(desc(tasks.createdAt))
            .limit(RECENT_TASKS),
          memoryExcerpt(workspaceConfig, repoUrl),
        ])

        return c.json({
          repository: {
            id,
            repoUrl,
            taskCount: known?.taskCount ?? 0,
            lastUsedAt: known?.lastUsedAt ?? null,
            isDefault: repoUrl === defaultRepoUrl,
            // Null until provisioning resolved the repository's default (REQ-703);
            // the last task that ran is the best answer anyone has here.
            baseBranch: recentTasks.find((task) => task.baseBranch)?.baseBranch ?? null,
          },
          // What the owner set, and what a real checkout actually resolved on the
          // last task that ran (REQ-1702). The second is ground truth and the
          // first is only an instruction, so a screen showing one without the
          // other would be guessing at the more interesting half.
          specConvention: {
            setting: specConvention ?? null,
            resolved: recentTasks.find((task) => task.specConvention)?.specConvention ?? null,
          },
          coverageWaiver: waiver[0] ?? null,
          recentTasks: recentTasks.map(
            ({ baseBranch: _baseBranch, specConvention: _convention, ...task }) => task,
          ),
          memory,
        })
      })
  )

  /**
   * What a launch of this text would do, without doing it (REQ-1019). Calls
   * the resolver `POST /tasks` calls, so the launch screen cannot name a
   * repository the launch would not use.
   *
   * A POST that creates nothing: the request text is capped at 20,000 bytes
   * and does not belong in a query string, and truncating it to fit would
   * answer a different question than the launch answers.
   */
}
