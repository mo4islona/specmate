import {
  type ModelBindings,
  type ModelBindingsOverride,
  resolveModelBindings,
} from '@specmate/core'
import { eq } from 'drizzle-orm'
import type { DbClient } from './index.ts'
import { appSettings } from './schema.ts'

/** The `app_settings` keys wired up today — see model-settings/design.md. */
const MODEL_DEFAULTS_KEY = 'model-defaults'
const DEFAULT_REPOSITORY_KEY = 'default-repository'

export type ModelDefaultsUpdate = ModelBindingsOverride

export async function getModelDefaults(db: DbClient): Promise<ModelBindings> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, MODEL_DEFAULTS_KEY))
    .limit(1)

  // Falls back to DEFAULT_MODEL_BINDINGS per role only if the seed migration's
  // row is somehow missing — never the live behavior for an installed system.
  return resolveModelBindings((row?.value as ModelDefaultsUpdate) ?? {})
}

/**
 * Partial update per role, per field — merged into the stored row; unnamed fields keep their
 * current value. Reads the row `for update` inside a transaction so two concurrent updates (e.g.
 * two role edits fired back to back from the Settings screen) serialize instead of racing on the
 * same read-then-write and silently dropping one of them.
 */
export async function updateModelDefaults(
  db: DbClient,
  update: ModelDefaultsUpdate,
): Promise<ModelBindings> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, MODEL_DEFAULTS_KEY))
      .limit(1)
      .for('update')

    const current = resolveModelBindings((row?.value as ModelDefaultsUpdate) ?? {})
    const merged = resolveModelBindings(current, update)

    await tx
      .insert(appSettings)
      .values({ key: MODEL_DEFAULTS_KEY, value: merged, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: merged, updatedAt: new Date() },
      })

    return merged
  })
}

/**
 * The repository a launch falls back to when the request named none (REQ-1017).
 * It may name a repository no task has run against — otherwise a fresh install
 * could never set one.
 */
export async function getDefaultRepository(db: DbClient): Promise<string | null> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, DEFAULT_REPOSITORY_KEY))
    .limit(1)

  const repoUrl = (row?.value as { repoUrl?: unknown } | undefined)?.repoUrl

  return typeof repoUrl === 'string' && repoUrl.length > 0 ? repoUrl : null
}

/** Passing `null` clears the setting: absent and "cleared" are the same state. */
export async function setDefaultRepository(
  db: DbClient,
  repoUrl: string | null,
): Promise<string | null> {
  if (repoUrl === null) {
    await db.delete(appSettings).where(eq(appSettings.key, DEFAULT_REPOSITORY_KEY))

    return null
  }

  await db
    .insert(appSettings)
    .values({ key: DEFAULT_REPOSITORY_KEY, value: { repoUrl }, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: { repoUrl }, updatedAt: new Date() },
    })

  return repoUrl
}
