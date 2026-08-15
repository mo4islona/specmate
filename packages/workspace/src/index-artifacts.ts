import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ArtifactKind } from '@specmate/core'
import { artifacts, type Database } from '@specmate/db'
import { and, eq, like, notInArray, sql } from 'drizzle-orm'
import { artifactKindForPath } from './artifact-kinds.ts'
import type { WorkspaceConfig } from './config.ts'
import type { Git } from './git.ts'
import type { Workspace } from './manager.ts'

export interface IndexedArtifact {
  readonly path: string
  readonly kind: ArtifactKind
  readonly gitSha: string
}

/**
 * Re-scans the committed change folder rather than diffing: it holds a handful
 * of files, `ls-tree` reports exactly what is in the commit (so excluded
 * scratch cannot leak in), and the same routine backfills the index after a
 * repair.
 */
export async function indexChangeFolder(
  db: Database,
  git: Git,
  config: WorkspaceConfig,
  params: { taskId: string; workspace: Workspace; commit?: string },
): Promise<IndexedArtifact[]> {
  const { taskId, workspace } = params
  const listing = await git.run(
    ['ls-tree', '-r', params.commit ?? 'HEAD', '--', workspace.changeDir],
    { cwd: workspace.path },
  )

  const indexed: IndexedArtifact[] = []
  for (const line of listing.stdout.split('\n')) {
    const [meta, path] = line.split('\t')
    if (!meta || !path) continue
    const sha = meta.split(/\s+/)[2]
    if (!sha) continue
    const kind = artifactKindForPath(path.slice(workspace.changeDir.length + 1))
    if (!kind) continue
    indexed.push({ path, kind, gitSha: sha })
  }

  if (indexed.length > 0) {
    const rows = await Promise.all(
      indexed.map(async (artifact) => ({
        taskId,
        path: artifact.path,
        kind: artifact.kind,
        gitSha: artifact.gitSha,
        snapshotMd: await snapshot(join(workspace.path, artifact.path), config.snapshotLimitBytes),
      })),
    )
    await db
      .insert(artifacts)
      .values(rows)
      .onConflictDoUpdate({
        target: [artifacts.taskId, artifacts.path],
        set: {
          kind: sql`excluded.kind`,
          gitSha: sql`excluded.git_sha`,
          snapshotMd: sql`excluded.snapshot_md`,
          updatedAt: new Date(),
        },
      })
  }

  // Anything still on record under this change folder is gone from the commit.
  const kept = indexed.map((artifact) => artifact.path)
  await db
    .delete(artifacts)
    .where(
      and(
        eq(artifacts.taskId, taskId),
        like(artifacts.path, `${workspace.changeDir}/%`),
        kept.length > 0 ? notInArray(artifacts.path, kept) : undefined,
      ),
    )

  return indexed
}

/** The snapshot only feeds the UI; git holds the truth, so truncation is safe. */
async function snapshot(path: string, limitBytes: number): Promise<string | null> {
  const content = await readFile(path).catch(() => null)
  if (!content) return null
  return content.subarray(0, limitBytes).toString('utf8')
}
