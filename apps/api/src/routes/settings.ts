import {
  getDefaultRepository,
  getModelDefaults,
  getSpecConventions,
  SuitePathRequiredError,
  setDefaultRepository,
  setSpecConvention,
  updateModelDefaults,
} from '@specmate/db'
import { Hono } from 'hono'
import { validator } from 'hono/validator'
import type { RouteContext } from './context.ts'
import { UpdateDefaultRepository, UpdateModelDefaults, UpdateSpecConvention } from './schemas.ts'
import { validateJson } from './validation.ts'

/** The settings that outlive any one task: model defaults, the default repository, spec conventions. */
export function settingsRoutes(ctx: RouteContext) {
  const { db } = ctx

  return new Hono()
    .get('/settings/model-defaults', async (c) => {
      const defaults = await getModelDefaults(db)
      return c.json({ modelDefaults: defaults })
    })

    .put(
      '/settings/model-defaults',
      validator('json', validateJson(UpdateModelDefaults)),
      async (c) => {
        const update = c.req.valid('json')
        const defaults = await updateModelDefaults(db, update)
        return c.json({ modelDefaults: defaults })
      },
    )

    .get('/settings/default-repository', async (c) => {
      const repoUrl = await getDefaultRepository(db)
      return c.json({ defaultRepository: repoUrl })
    })

    .put(
      '/settings/default-repository',
      validator('json', validateJson(UpdateDefaultRepository)),
      async (c) => {
        const { repoUrl } = c.req.valid('json')
        const stored = await setDefaultRepository(db, repoUrl)
        return c.json({ defaultRepository: stored })
      },
    )

    .get('/settings/spec-conventions', async (c) => {
      const specConventions = await getSpecConventions(db)
      return c.json({ specConventions })
    })

    .put(
      '/settings/spec-conventions',
      validator('json', validateJson(UpdateSpecConvention)),
      async (c) => {
        const { repoUrl, setting } = c.req.valid('json')
        try {
          const specConventions = await setSpecConvention(db, repoUrl, setting)
          return c.json({ specConventions })
        } catch (error) {
          // AC-977: the screen has to be able to say what is missing, which a 500 cannot.
          if (error instanceof SuitePathRequiredError) {
            return c.json({ error: error.message }, 422)
          }

          throw error
        }
      },
    )

  /**
   * The repositories this system works with — derived from the tasks that
   * name them, since a repository has no row of its own — each carrying the
   * coverage waiver in force for it, if any (REQ-1015). `mirrorKey` is the
   * identity: the same path-safe digest the workspace layer already names a
   * repository's mirror by, so one repository is one id everywhere.
   */
}
