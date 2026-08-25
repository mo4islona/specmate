import { Hono } from 'hono'
import type { RouteContext } from './context.ts'

/** What this build is, for a client that wants to know before it trusts anything else. */
export function metaRoutes(ctx: RouteContext) {
  const { config } = ctx

  return new Hono().get('/version', (c) =>
    c.json({
      name: 'specmate',
      phase: 0,
      env: config.NODE_ENV,
      revision: process.env.GIT_SHA ?? null,
    }),
  )
}
