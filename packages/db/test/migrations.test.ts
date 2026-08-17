import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SQL } from 'bun'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle')

// drizzle-kit hardcodes enum types to "public"; stripping that qualifier lets
// the same migration files run unqualified against an isolated test schema.
function readMigration(tag: string): string {
  return readFileSync(join(migrationsDir, `${tag}.sql`), 'utf8')
    .replaceAll('--> statement-breakpoint', '')
    .replaceAll('"public".', '')
}

const PRE_0004_MIGRATIONS = [
  '0000_init',
  '0001_complete_blacklash',
  '0002_hard_talisman',
  '0003_stale_chimera',
]

describeDb('0004 decisions node_key migration', () => {
  const schema = `migration_test_${randomUUID().replaceAll('-', '')}`
  let client: SQL

  beforeAll(async () => {
    client = new SQL({ url, max: 1 })
    await client.unsafe(`CREATE SCHEMA "${schema}"`)
    await client.unsafe(`SET search_path TO "${schema}"`)
    for (const tag of PRE_0004_MIGRATIONS) {
      await client.unsafe(readMigration(tag))
    }
  })

  afterAll(async () => {
    await client.unsafe(`DROP SCHEMA "${schema}" CASCADE`)
    await client.close()
  })

  test('backfills node_key on pre-existing decisions instead of failing the NOT NULL add', async () => {
    const [task] =
      await client`INSERT INTO tasks (slug, title, type, repo_url) VALUES ('legacy', 'Legacy', 'feature', 'https://example.com/repo') RETURNING id`
    const [graph] =
      await client`INSERT INTO run_graphs (task_id, version, dag) VALUES (${task.id}, 1, '{}') RETURNING id`
    const [stage] =
      await client`INSERT INTO stages (task_id, graph_id, node_key, role, provider, attempt) VALUES (${task.id}, ${graph.id}, 'implement.core', 'implementer', 'claude-code', 1) RETURNING id`

    // A decision predating this column has no stage-derived node to backfill from.
    await client`INSERT INTO decisions (task_id, key, kind, prompt_md, status) VALUES (${task.id}, 'legacy-key', 'question', 'Legacy prompt', 'open')`
    // A decision raised from a stage backfills node_key from that stage's node.
    await client`INSERT INTO decisions (task_id, stage_id, key, kind, prompt_md, status) VALUES (${task.id}, ${stage.id}, 'staged-key', 'question', 'Staged prompt', 'answered')`

    await client.unsafe(readMigration('0004_flimsy_war_machine'))

    const rows = await client`SELECT key, node_key, blocking FROM decisions ORDER BY key`
    expect(rows).toEqual([
      { key: 'legacy-key', node_key: '', blocking: true },
      { key: 'staged-key', node_key: 'implement.core', blocking: true },
    ])
  })
})
