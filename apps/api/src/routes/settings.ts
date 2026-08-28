import type { ModelBindingsOverride, ProviderId } from '@specmate/core'
import {
  getDefaultRepository,
  getModelDefaults,
  listSpecConventions,
  SuitePathRequiredError,
  setDefaultRepository,
  setSpecConvention,
  updateModelDefaults,
} from '@specmate/db'
import { mirrorKey } from '@specmate/workspace'
import { Hono } from 'hono'
import { validator } from 'hono/validator'
import type { RouteContext } from './context.ts'
import { UpdateDefaultRepository, UpdateModelDefaults, UpdateSpecConvention } from './schemas.ts'
import { validateJson } from './validation.ts'

/**
 * What a new record needs beyond its remote: the key its files will live under.
 * Minted here rather than in the store, because where a repository's files go is
 * the workspace layer's answer and not the database's (D1).
 */
function repositoryMint(repoUrl: string) {
  return { repoUrl, mirrorKey: mirrorKey(repoUrl) }
}

/** The settings that outlive any one task: model defaults, the default repository, spec conventions. */
export function settingsRoutes(ctx: RouteContext) {
  const { db, config } = ctx
  const availableProviders = config.AVAILABLE_PROVIDERS

  return (
    new Hono()
      // The configured set rides along: a binding may only name a provider this
      // deployment runs, and the screen offering one it does not would be offering
      // a choice the update below rejects (REQ-1014, REQ-917).
      .get('/settings/model-defaults', async (c) => {
        const defaults = await getModelDefaults(db)
        return c.json({ modelDefaults: defaults, availableProviders })
      })

      .put(
        '/settings/model-defaults',
        validator('json', validateJson(UpdateModelDefaults)),
        async (c) => {
          const update = c.req.valid('json')
          const unconfigured = unconfiguredProviders(update, availableProviders)
          if (Object.keys(unconfigured).length > 0) {
            return c.json(
              {
                error: 'validation',
                detail: 'a role names a provider this deployment does not run',
                fields: unconfigured,
              },
              400,
            )
          }

          const defaults = await updateModelDefaults(db, update)
          return c.json({ modelDefaults: defaults, availableProviders })
        },
      )

      .get('/settings/default-repository', async (c) => {
        const repository = await getDefaultRepository(db)
        return c.json({ defaultRepository: repository?.repoUrl ?? null })
      })

      .put(
        '/settings/default-repository',
        validator('json', validateJson(UpdateDefaultRepository)),
        async (c) => {
          const { repoUrl } = c.req.valid('json')
          // Naming a repository nothing has run against is the point of the setting
          // (AC-347), so this is one of the two places a record is minted.
          const stored = await setDefaultRepository(db, repoUrl ? repositoryMint(repoUrl) : null)
          return c.json({ defaultRepository: stored?.repoUrl ?? null })
        },
      )

      .get('/settings/spec-conventions', async (c) => {
        const specConventions = await listSpecConventions(db)
        return c.json({ specConventions })
      })

      .put(
        '/settings/spec-conventions',
        validator('json', validateJson(UpdateSpecConvention)),
        async (c) => {
          const { repoUrl, setting } = c.req.valid('json')
          try {
            await setSpecConvention(db, repositoryMint(repoUrl), setting)
            return c.json({ specConventions: await listSpecConventions(db) })
          } catch (error) {
            // AC-977: the screen has to be able to say what is missing, which a 500 cannot.
            if (error instanceof SuitePathRequiredError) {
              return c.json({ error: error.message }, 422)
            }

            throw error
          }
        },
      )
  )
}

/** Named by field, the way every other rejection here names one. */
function unconfiguredProviders(
  update: ModelBindingsOverride,
  available: readonly ProviderId[],
): Record<string, string[]> {
  const fields: Record<string, string[]> = {}
  for (const [role, binding] of Object.entries(update)) {
    const provider = binding?.provider
    if (!provider || available.includes(provider)) continue

    fields[`${role}.provider`] = [`${provider} is not a provider this deployment runs`]
  }

  return fields
}
