import { createDb, databaseUrl, ping } from '@specmate/db'
import { z } from 'zod'

const Env = z.object({
  DATABASE_URL: z.string().min(1),
  ORCHESTRATOR_PORT: z.coerce.number().int().positive().default(4100),
  /** How often the (currently empty) work loop wakes up. */
  TICK_INTERVAL_MS: z.coerce.number().int().positive().default(5_000),
})

const env = Env.parse(process.env)
const db = createDb(databaseUrl())

// Phase 0: the loop proves the process boots, holds a DB connection and shuts
// down cleanly. The state machine lands in Phase 1.
let ticks = 0
let healthy = false

async function tick(): Promise<void> {
  healthy = await ping(db).catch(() => false)
  ticks += 1
}

await tick()

const timer = setInterval(() => void tick(), env.TICK_INTERVAL_MS)

const server = Bun.serve({
  port: env.ORCHESTRATOR_PORT,
  fetch(req) {
    const { pathname } = new URL(req.url)
    if (pathname === '/healthz') return Response.json({ ok: true })
    if (pathname === '/readyz') {
      return Response.json({ ok: healthy, ticks }, { status: healthy ? 200 : 503 })
    }
    return new Response('not found', { status: 404 })
  },
})

console.info(`specmate orchestrator listening on ${server.url}`)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.info(`${signal} received, stopping orchestrator`)
    clearInterval(timer)
    void server.stop(false).then(() => process.exit(0))
  })
}
