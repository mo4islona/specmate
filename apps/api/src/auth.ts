import { timingSafeEqual } from 'node:crypto'
import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  // timingSafeEqual throws on length mismatch; compare lengths separately.
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB)
}

/**
 * Single-owner auth: one shared secret, sent as `Authorization: Bearer <pw>`.
 * The service is meant to sit behind Tailscale — this is the second lock, not the first.
 */
export function passwordAuth(password: string | undefined) {
  return createMiddleware(async (c, next) => {
    if (!password) return next()
    const header = c.req.header('authorization') ?? ''
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
    if (!constantTimeEquals(token, password)) {
      throw new HTTPException(401, { message: 'unauthorized' })
    }
    return next()
  })
}
