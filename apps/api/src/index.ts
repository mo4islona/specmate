import { createDb } from '@specmate/db'
import { createApp } from './app.ts'
import { loadConfig } from './config.ts'

const config = loadConfig()
const db = createDb(config.DATABASE_URL)
const app = createApp({ db, config })

const server = Bun.serve({
  port: config.API_PORT,
  fetch: app.fetch,
  development: config.NODE_ENV === 'development',
})

console.info(`specmate api listening on ${server.url}`)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.info(`${signal} received, draining`)
    void server.stop(false).then(() => process.exit(0))
  })
}
