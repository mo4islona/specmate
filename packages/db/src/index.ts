import { SQL } from 'bun'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/bun-sql'
import * as schema from './schema.ts'

export * from './conversation-store.ts'
export * from './schema.ts'
export * from './settings-store.ts'
export { schema }

function openDb(url: string) {
  const client = new SQL({ url, max: Number(process.env.DATABASE_POOL_MAX ?? 10) })
  return drizzle({ client, schema, casing: 'snake_case' })
}

export type Database = ReturnType<typeof openDb>

export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

/** A database handle or an open transaction — query helpers accept either. */
export type DbClient = Database | Transaction

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  return url
}

/**
 * A pool of ten, held for as long as whatever opened it runs. A service opens
 * one at startup and gives it back by exiting; a test suite has to hand it back
 * itself, in `afterAll` — nineteen suites that do not exhaust a
 * hundred-connection server partway through the run, and the suite that happens
 * to be running when the last connection goes is the one that appears to fail.
 */
export function createDb(url: string = databaseUrl()): Database {
  return openDb(url)
}

/** Cheap liveness probe used by /healthz on every service. */
export async function ping(db: Database): Promise<boolean> {
  const rows = await db.execute(sql`select 1 as ok`)
  return rows.length > 0
}
