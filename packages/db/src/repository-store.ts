import { normalizeRemote, type SpecConventionSetting } from '@specmate/core'
import { eq, isNotNull } from 'drizzle-orm'
import type { DbClient } from './index.ts'
import { repositories } from './schema.ts'

export type Repository = typeof repositories.$inferSelect

export class SuitePathRequiredError extends Error {
  constructor() {
    super('the custom profile needs the path its specification suite lives at')
    this.name = 'SuitePathRequiredError'
  }
}

/**
 * What a row needs that this package cannot work out for itself. The mirror key is
 * a digest over the remote and belongs with the paths it names, not here (D1); the
 * caller mints one, and on a repository that already has a row it is ignored — the
 * key the files already live under is the one that stays.
 */
export interface RepositoryMint {
  readonly repoUrl: string
  readonly mirrorKey: string
}

/**
 * REQ-316, D4. One row per identity, minted or found in a single statement: two
 * launches against one repository race here, and `on conflict` is what makes the
 * loser read the winner's row instead of failing or minting a second.
 *
 * The conflict clause updates rather than does nothing because `do nothing`
 * returns no row at all, and the caller always needs one.
 */
export async function findOrCreateRepository(
  db: DbClient,
  mint: RepositoryMint,
): Promise<Repository> {
  const normalized = normalizeRemote(mint.repoUrl)

  const [row] = await db
    .insert(repositories)
    .values({ normalized, repoUrl: mint.repoUrl, mirrorKey: mint.mirrorKey })
    .onConflictDoUpdate({ target: repositories.normalized, set: { normalized } })
    .returning()

  if (!row) throw new Error(`could not resolve a repository for ${mint.repoUrl}`)

  return row
}

/** The record for a remote however it is spelled, or undefined where there is none. */
export async function getRepositoryByUrl(
  db: DbClient,
  repoUrl: string,
): Promise<Repository | undefined> {
  const [row] = await db
    .select()
    .from(repositories)
    .where(eq(repositories.normalized, normalizeRemote(repoUrl)))
    .limit(1)

  return row
}

/** By the key the REST surface addresses a repository with (D1). */
export async function getRepositoryByMirrorKey(
  db: DbClient,
  mirrorKey: string,
): Promise<Repository | undefined> {
  const [row] = await db
    .select()
    .from(repositories)
    .where(eq(repositories.mirrorKey, mirrorKey))
    .limit(1)

  return row
}

export async function listRepositories(db: DbClient): Promise<Repository[]> {
  return db.select().from(repositories)
}

/**
 * The repository a launch falls back to when the request named none (REQ-1017).
 * It may be one no task has run against — otherwise a fresh install could never
 * set one.
 */
export async function getDefaultRepository(db: DbClient): Promise<Repository | null> {
  const [row] = await db
    .select()
    .from(repositories)
    .where(eq(repositories.isDefault, true))
    .limit(1)

  return row ?? null
}

/**
 * Passing `null` clears it: absent and "cleared" are the same state. The old
 * default is stood down before the new one is raised because the database holds
 * the pair to one (AC-348), and two rows flagged at once is what it refuses.
 */
export async function setDefaultRepository(
  db: DbClient,
  mint: RepositoryMint | null,
): Promise<Repository | null> {
  return db.transaction(async (tx) => {
    await tx
      .update(repositories)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(eq(repositories.isDefault, true))

    if (!mint) return null

    const repository = await findOrCreateRepository(tx, mint)
    const [row] = await tx
      .update(repositories)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(eq(repositories.id, repository.id))
      .returning()

    return row ?? null
  })
}

/** What one repository's tasks run under, or undefined where the owner set nothing. */
export async function getSpecConvention(
  db: DbClient,
  repoUrl: string,
): Promise<SpecConventionSetting | undefined> {
  const repository = await getRepositoryByUrl(db, repoUrl)

  return repository?.specConvention ?? undefined
}

/** Every repository the owner has set a convention for, keyed by identity. */
export async function listSpecConventions(
  db: DbClient,
): Promise<Record<string, SpecConventionSetting>> {
  const rows = await db
    .select({ normalized: repositories.normalized, setting: repositories.specConvention })
    .from(repositories)
    .where(isNotNull(repositories.specConvention))

  return Object.fromEntries(
    rows.flatMap((row) => (row.setting ? [[row.normalized, row.setting] as const] : [])),
  )
}

/**
 * Passing `null` returns the repository to detection. One statement per call now
 * that the setting is a column: the read-then-write under `for update` existed to
 * stop two edits clobbering each other inside one JSON map, and there is no map.
 */
export async function setSpecConvention(
  db: DbClient,
  mint: RepositoryMint,
  setting: SpecConventionSetting | null,
): Promise<Repository> {
  // AC-977: a custom profile without a location would point the planner at nothing and
  // resolve back to `none` on every task, without ever saying why.
  if (setting?.profile === 'custom' && !setting.suitePath?.trim()) {
    throw new SuitePathRequiredError()
  }

  const repository = await findOrCreateRepository(db, mint)
  const [row] = await db
    .update(repositories)
    .set({ specConvention: setting, updatedAt: new Date() })
    .where(eq(repositories.id, repository.id))
    .returning()

  if (!row) throw new Error(`could not write the convention for ${mint.repoUrl}`)

  return row
}

/**
 * What provisioning resolved the repository's default branch to (REQ-703). Written
 * where it was read, so a repository nothing has run against can still be listed
 * with the branch a later task found.
 */
export async function recordDefaultBranch(
  db: DbClient,
  repositoryId: string,
  defaultBranch: string,
): Promise<void> {
  await db
    .update(repositories)
    .set({ defaultBranch, updatedAt: new Date() })
    .where(eq(repositories.id, repositoryId))
}
