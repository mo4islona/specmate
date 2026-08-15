import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SQL } from 'bun'
import { drizzle } from 'drizzle-orm/bun-sql'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { databaseUrl } from './index.ts'

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle')

const client = new SQL({ url: databaseUrl(), max: 1 })
const db = drizzle({ client })

await migrate(db, { migrationsFolder })
await client.close()

console.info(`migrations applied from ${migrationsFolder}`)
