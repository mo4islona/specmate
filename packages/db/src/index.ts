import { SQL } from 'bun'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/bun-sql'
import * as schema from './schema.ts'

export * from './conversation-store.ts'
export * from './schema.ts'
export { schema }

export type Database = ReturnType<typeof createDb>

export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

/** A database handle or an open transaction — query helpers accept either. */
export type DbClient = Database | Transaction

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  return url
}

export function createDb(url: string = databaseUrl()) {
  const client = new SQL({ url, max: Number(process.env.DATABASE_POOL_MAX ?? 10) })
  return drizzle({ client, schema, casing: 'snake_case' })
}

/** Cheap liveness probe used by /healthz on every service. */
export async function ping(db: Database): Promise<boolean> {
  const rows = await db.execute(sql`select 1 as ok`)
  return rows.length > 0
}
