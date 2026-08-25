import { ping } from '@specmate/db'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { passwordAuth } from './auth.ts'
import { ApiError, handleApiError } from './errors.ts'
import { attentionRoutes } from './routes/attention.ts'
import { type AppDeps, createRouteContext } from './routes/context.ts'
import { conversationRoutes } from './routes/conversations.ts'
import { decisionRoutes } from './routes/decisions.ts'
import { eventRoutes } from './routes/events.ts'
import { gateRoutes } from './routes/gates.ts'
import { intakeRoutes } from './routes/intake.ts'
import { metaRoutes } from './routes/meta.ts'
import { repositoryRoutes } from './routes/repositories.ts'
import { settingsRoutes } from './routes/settings.ts'
import { stageRoutes } from './routes/stages.ts'
import { taskRoutes } from './routes/tasks.ts'

export type {
  AppDeps,
  GateOperations,
  ReferenceReads,
  RepositoryProbes,
  StreamSettings,
  WorkspaceDiffOperations,
} from './routes/context.ts'

/**
 * The composition root: the middleware, the two unauthenticated probes, and one
 * module per resource mounted behind the password. Nothing is handled here —
 * every handler lives in `routes/`, so what this file shows is the shape of the
 * surface rather than 1,600 lines of it.
 *
 * Mount order is part of the contract. Hono matches in registration order, so a
 * literal path has to stay ahead of the parameterised one that would otherwise
 * swallow it — `/repositories/probe` before `/repositories/:id` — which is why
 * those two live in one module rather than being grouped by verb.
 */
export function createApp(deps: AppDeps) {
  const app = new Hono()
  const ctx = createRouteContext(deps)

  app.use('*', logger())

  app.onError(handleApiError)

  // Unauthenticated probes — no task data, safe for container healthchecks.
  app.get('/healthz', (c) => c.json({ ok: true }))
  app.get('/readyz', async (c) => {
    try {
      await ping(deps.db)

      return c.json({ ok: true, db: 'up' })
    } catch {
      throw new ApiError('internal', 'database is unavailable', { status: 503 })
    }
  })

  const routes = new Hono()
    .use('*', passwordAuth(deps.config.SPECMATE_PASSWORD))
    .route('/', metaRoutes(ctx))
    .route('/', attentionRoutes(ctx))
    .route('/', settingsRoutes(ctx))
    .route('/', repositoryRoutes(ctx))
    .route('/', intakeRoutes(ctx))
    .route('/', taskRoutes(ctx))
    .route('/', conversationRoutes(ctx))
    .route('/', stageRoutes(ctx))
    .route('/', gateRoutes(ctx))
    .route('/', decisionRoutes(ctx))
    .route('/', eventRoutes(ctx))

  return app.route('/api/v1', routes)
}

export type AppType = ReturnType<typeof createApp>
