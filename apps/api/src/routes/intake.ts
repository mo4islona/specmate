import { getDefaultRepository } from '@specmate/db'
import { type ForgeReference, referencesIn } from '@specmate/github'
import { mirrorKey } from '@specmate/workspace'
import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { resolveRepository } from '../intake.ts'
import type { RouteContext } from './context.ts'
import { knownRepositories } from './known-repositories.ts'
import { PreviewIntake, ReadReference } from './schemas.ts'
import { validateJson, validateQuery } from './validation.ts'

/**
 * What a launch of this text would do, answered before it launches. The preview
 * runs the same `resolveRepository` the create path does, which is what stops
 * the rail and the launch disagreeing (REQ-1900).
 */
export function intakeRoutes(ctx: RouteContext) {
  const { db, referenceReads } = ctx

  return (
    new Hono()
      .post('/intake/preview', validator('json', validateJson(PreviewIntake)), async (c) => {
        const { description, repoUrl } = c.req.valid('json')
        const [known, defaultRepoUrl] = await Promise.all([
          knownRepositories(db),
          getDefaultRepository(db),
        ])
        const resolution = resolveRepository({
          repoUrl,
          request: description,
          known: known.map((row) => row.repoUrl),
          defaultRepoUrl,
        })
        const identify = (url: string) => ({ repoUrl: url, id: mirrorKey(url) })
        const isKnown = (url: string) =>
          known.some((row) => mirrorKey(row.repoUrl) === mirrorKey(url))

        return c.json({
          repository: resolution.resolved
            ? {
                resolved: true as const,
                ...identify(resolution.repoUrl),
                via: resolution.via,
                known: isKnown(resolution.repoUrl),
                reason: null,
                candidates: [],
              }
            : {
                resolved: false as const,
                repoUrl: null,
                id: null,
                via: null,
                known: false,
                reason: resolution.reason,
                candidates: resolution.candidates.map(identify),
              },
          references: referencesIn(description),
        })
      })

      /**
       * REQ-1021: what a reference points at, or why it could not be read. Never
       * an error status — nothing about launching a task depends on this, and a
       * screen showing a link with a reason beats one showing a failure.
       */
      .get('/references', validator('query', validateQuery(ReadReference)), async (c) => {
        const query = c.req.valid('query')
        const reference: ForgeReference = {
          ...query,
          url: `https://${query.host}/${query.owner}/${query.repo}/${
            query.kind === 'pull' ? 'pull' : 'issues'
          }/${query.number}`,
          explicit: true,
        }

        return c.json({ reference, result: await referenceReads.read(reference) })
      })
  )
}
