import { type Database, repositories, tasks } from '@specmate/db'
import { count, eq, max, sql } from 'drizzle-orm'

export interface KnownRepository {
  id: string
  mirrorKey: string
  repoUrl: string
  isDefault: boolean
  taskCount: number
  lastUsedAt: Date | null
}

/**
 * The repositories this system knows, most recently used first. A repository has
 * a record of its own now (REQ-316); how often it has been used is still counted
 * from the tasks, because that is what the question means and denormalising it
 * would be a second copy to keep honest.
 *
 * REQ-1017's contents are unchanged: what has run, plus the default. A record the
 * owner configured and nothing has used is deliberately not on this list — see
 * the change's Non-goals.
 *
 * Shared because resolution, the repository list and the launch preview all have
 * to be looking at the same set.
 */
export async function knownRepositories(db: Database): Promise<KnownRepository[]> {
  const rows = await db
    .select({
      id: repositories.id,
      mirrorKey: repositories.mirrorKey,
      repoUrl: repositories.repoUrl,
      isDefault: repositories.isDefault,
      taskCount: count(tasks.id),
      lastUsedAt: max(tasks.createdAt),
    })
    .from(repositories)
    .leftJoin(tasks, eq(tasks.repositoryId, repositories.id))
    .groupBy(repositories.id)
    // Postgres sorts nulls first on a descending order, which would put the
    // repository nothing has run against at the top of "most recently used".
    .orderBy(sql`max(${tasks.createdAt}) desc nulls last`)

  return rows
    .filter((row) => row.taskCount > 0 || row.isDefault)
    .map((row) => ({ ...row, lastUsedAt: row.lastUsedAt ?? null }))
}
