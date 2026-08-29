import { readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import type { ArtifactKind } from '@specmate/core'
import { artifacts, type Database } from '@specmate/db'
import { and, eq, like, notInArray, sql } from 'drizzle-orm'
import { artifactKindForPath } from './artifact-kinds.ts'
import type { WorkspaceConfig } from './config.ts'
import { walkMarkdown } from './fs.ts'
import type { Git } from './git.ts'
import type { Workspace } from './manager.ts'
import { changeLayoutOf } from './paths.ts'

export interface IndexedArtifact {
  readonly path: string
  readonly kind: ArtifactKind
  /** Null for an artifact the repository does not carry: there is no commit to name. */
  readonly gitSha: string | null
}

/**
 * Re-scans the change folder rather than diffing: it holds a handful of files, and the
 * same routine backfills the index after a repair.
 *
 * Where the repository carries the folder, the commit is what is read — `ls-tree`
 * reports exactly what went in, so excluded scratch cannot leak into the index, and git
 * holds the content the stored copy is only a rendering of. Where it does not
 * (REQ-1707), there is no commit to read and the working tree is the only statement of
 * what the stage wrote; the stored copy is then the artifact itself, so it is kept whole
 * rather than cut to a display ceiling (REQ-301).
 */
export async function indexChangeFolder(
  db: Database,
  git: Git,
  config: WorkspaceConfig,
  params: { taskId: string; workspace: Workspace; commit?: string },
): Promise<IndexedArtifact[]> {
  const { taskId, workspace } = params
  const keptByRepository = changeLayoutOf(workspace.changeDir) === 'repository'
  const indexed = keptByRepository
    ? await committedArtifacts(git, workspace, params.commit)
    : await writtenArtifacts(workspace)

  if (indexed.length > 0) {
    const limit = keptByRepository ? config.snapshotLimitBytes : Number.POSITIVE_INFINITY
    const rows = await Promise.all(
      indexed.map(async (artifact) => ({
        taskId,
        path: artifact.path,
        kind: artifact.kind,
        gitSha: artifact.gitSha,
        snapshotMd: await snapshot(join(workspace.path, artifact.path), limit),
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

  // Anything still on record under this change folder is gone from the stage's output.
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

async function committedArtifacts(
  git: Git,
  workspace: Workspace,
  commit?: string,
): Promise<IndexedArtifact[]> {
  const listing = await git.run(['ls-tree', '-r', commit ?? 'HEAD', '--', workspace.changeDir], {
    cwd: workspace.path,
  })

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

  return indexed
}

async function writtenArtifacts(workspace: Workspace): Promise<IndexedArtifact[]> {
  const folder = join(workspace.path, workspace.changeDir)
  const indexed: IndexedArtifact[] = []
  for (const file of await walkMarkdown(folder)) {
    const within = relative(folder, file)
    const kind = artifactKindForPath(within)
    if (!kind) continue
    indexed.push({ path: `${workspace.changeDir}/${within}`, kind, gitSha: null })
  }

  return indexed
}

/** Cut to a ceiling only where git holds the artifact and this copy is a rendering. */
async function snapshot(path: string, limitBytes: number): Promise<string | null> {
  const content = await readFile(path).catch(() => null)
  if (!content) return null

  return Number.isFinite(limitBytes)
    ? content.subarray(0, limitBytes).toString('utf8')
    : content.toString('utf8')
}
