import { type Database, tasks } from '@specmate/db'
import { count, desc, max } from 'drizzle-orm'

/**
 * The repositories this system has tasks against, most recently used first.
 * A repository has no row of its own — the tasks that name it are the record
 * (REQ-1017). Shared because resolution, the repository list and the launch
 * preview all have to be looking at the same set.
 */
export async function knownRepositories(
  db: Database,
): Promise<{ repoUrl: string; taskCount: number; lastUsedAt: Date | null }[]> {
  const rows = await db
    .select({
      repoUrl: tasks.repoUrl,
      taskCount: count(tasks.id),
      lastUsedAt: max(tasks.createdAt),
    })
    .from(tasks)
    .groupBy(tasks.repoUrl)
    .orderBy(desc(max(tasks.createdAt)))

  return rows.map((row) => ({ ...row, lastUsedAt: row.lastUsedAt ?? null }))
}
