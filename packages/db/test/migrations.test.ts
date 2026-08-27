import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeRemote } from '@specmate/core'
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

describeDb('0004 decisions node_key migration — duplicate open decisions', () => {
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

  test('dedups pre-existing open decisions that collide on the new (task, node_key, key) identity instead of failing the unique index', async () => {
    const [task] =
      await client`INSERT INTO tasks (slug, title, type, repo_url) VALUES ('legacy-dup', 'Legacy dup', 'feature', 'https://example.com/repo') RETURNING id`

    // Two legacy decisions with no stage_id both backfill to node_key = '' and
    // share the same key — the exact collision the new unique index forbids.
    const [older] =
      await client`INSERT INTO decisions (task_id, key, kind, prompt_md, status, created_at) VALUES (${task.id}, 'dup-key', 'question', 'Older prompt', 'open', now() - interval '1 hour') RETURNING id`
    const [newer] =
      await client`INSERT INTO decisions (task_id, key, kind, prompt_md, status, created_at) VALUES (${task.id}, 'dup-key', 'question', 'Newer prompt', 'open', now()) RETURNING id`

    await client.unsafe(readMigration('0004_flimsy_war_machine'))

    const rows =
      await client`SELECT id, status, node_key FROM decisions WHERE task_id = ${task.id} ORDER BY created_at`
    expect(rows).toEqual([
      { id: older.id, status: 'dismissed', node_key: '' },
      { id: newer.id, status: 'open', node_key: '' },
    ])

    const [{ count }] =
      await client`SELECT count(*)::int FROM decisions WHERE task_id = ${task.id} AND node_key = '' AND key = 'dup-key' AND status = 'open'`
    expect(count).toBe(1)
  })
})

const PRE_0014_MIGRATIONS = [
  ...PRE_0004_MIGRATIONS,
  '0004_flimsy_war_machine',
  '0005_sudden_selene',
  '0006_tiny_polaris',
  '0007_sharp_multiple_man',
  '0008_gray_saracen',
  '0009_colorful_morlun',
  '0010_bumpy_charles_xavier',
  '0011_magenta_lethal_legion',
  '0012_mighty_george_stacy',
  '0013_even_mercury',
]

/**
 * Every way one repository can arrive spelled, and one that only looks similar.
 * The migration groups by a transcription of `normalizeRemote` written in SQL, so
 * this table is what holds the transcription to the function: whatever the two
 * disagree about shows up here as a row that failed to fold or one that folded
 * that should not have.
 */
const SPELLINGS = [
  'https://github.com/example/wick',
  'https://github.com/example/wick.git',
  'https://github.com/example/wick.git/',
  'git@github.com:example/wick.git',
  'ssh://git@github.com/example/wick',
  'HTTPS://GitHub.com/Example/Wick',
  '  https://github.com/example/wick  ',
]

const OTHER_REPO = 'https://github.com/example/wick-charts'
/** Named by a setting and nothing else: it has no task, and must still get a row. */
const CONFIGURED_ONLY = 'https://github.com/example/configured-only'

describeDb('0014 repositories migration', () => {
  const schema = `migration_test_${randomUUID().replaceAll('-', '')}`
  let client: SQL

  beforeAll(async () => {
    client = new SQL({ url, max: 1 })
    await client.unsafe(`CREATE SCHEMA "${schema}"`)
    await client.unsafe(`SET search_path TO "${schema}"`)
    for (const tag of PRE_0014_MIGRATIONS) {
      await client.unsafe(readMigration(tag))
    }
  })

  afterAll(async () => {
    await client.unsafe(`DROP SCHEMA "${schema}" CASCADE`)
    await client.close()
  })

  test('folds every spelling of one remote into one row, keeping the newest task’s mirror', async () => {
    // Oldest first, so the last spelling in the table is the most recent task and
    // is the one whose spelling and mirror the row must keep.
    for (const [index, spelling] of SPELLINGS.entries()) {
      await client`INSERT INTO tasks (slug, title, type, repo_url, created_at)
        VALUES (${`spelling-${index}`}, 'Spelling', 'feature', ${spelling},
                now() - make_interval(hours => ${SPELLINGS.length - index}))`
    }
    await client`INSERT INTO tasks (slug, title, type, repo_url)
      VALUES ('other', 'Other', 'feature', ${OTHER_REPO})`

    // Written the way the driver's double-encoding era left it — a jsonb string
    // holding the JSON rather than the object. The migration has to read it.
    await client`INSERT INTO app_settings (key, value) VALUES ('default-repository',
      ${JSON.stringify({ repoUrl: OTHER_REPO })}::jsonb)`
    await client`INSERT INTO app_settings (key, value) VALUES ('spec-conventions',
      ${{
        [normalizeRemote(SPELLINGS[0] as string)]: { profile: 'openspec' },
        [normalizeRemote(CONFIGURED_ONLY)]: { profile: 'custom', suitePath: 'docs/spec' },
      }})`

    // Both spellings hold an acceptance open; per the record only one can.
    const [oldWaiver] = await client`INSERT INTO coverage_waivers (repo_url, created_at)
      VALUES (${SPELLINGS[0]}, now() - interval '2 hours') RETURNING id`
    const [newWaiver] = await client`INSERT INTO coverage_waivers (repo_url, created_at)
      VALUES (${SPELLINGS[3]}, now() - interval '1 hour') RETURNING id`

    await client.unsafe(readMigration('0014_lonely_quentin_quire'))

    const rows = await client`SELECT normalized, repo_url, mirror_key, spec_convention, is_default
      FROM repositories ORDER BY normalized`
    const expected = [...new Set([...SPELLINGS, OTHER_REPO, CONFIGURED_ONLY].map(normalizeRemote))]
    expect(rows.map((row: { normalized: string }) => row.normalized)).toEqual(expected.toSorted())

    const wick = rows.find(
      (row: { normalized: string }) => row.normalized === normalizeRemote(OTHER_REPO),
    )
    const folded = rows.find(
      (row: { normalized: string }) => row.normalized === normalizeRemote(SPELLINGS[0] as string),
    )
    // The newest task spelled it with surrounding whitespace; the row keeps the
    // string as it was given, and the identity is what folded.
    expect(folded.repo_url).toBe(SPELLINGS.at(-1))
    expect(folded.spec_convention).toEqual({ profile: 'openspec' })

    // A repository named only by a setting still gets a row, and a mirror key it
    // can be provisioned under.
    const configured = rows.find(
      (row: { normalized: string }) => row.normalized === normalizeRemote(CONFIGURED_ONLY),
    )
    expect(configured.spec_convention).toEqual({ profile: 'custom', suitePath: 'docs/spec' })
    expect(configured.mirror_key).toMatch(/^[a-z0-9._-]+$/)

    const defaults = rows.filter((row: { is_default: boolean }) => row.is_default)
    expect(defaults).toHaveLength(1)
    expect(defaults[0].normalized).toBe(wick.normalized)

    const [{ count: settingsLeft }] =
      await client`SELECT count(*)::int FROM app_settings WHERE key IN ('spec-conventions', 'default-repository')`
    expect(settingsLeft).toBe(0)

    // The pin: for every spelling seeded, the row the migration's SQL grouped the
    // task into is the one `normalizeRemote` names. A transcription that drifts
    // shows up here rather than as two mirrors months later.
    const mapped = await client`SELECT t.repo_url, r.normalized FROM tasks t
      JOIN repositories r ON r.id = t.repository_id`
    expect(mapped).toHaveLength(SPELLINGS.length + 1)
    for (const row of mapped as { repo_url: string; normalized: string }[]) {
      expect(row.normalized).toBe(normalizeRemote(row.repo_url))
    }

    const waivers =
      await client`SELECT id, revoked_at IS NULL AS in_force FROM coverage_waivers ORDER BY created_at`
    expect(waivers).toEqual([
      { id: oldWaiver.id, in_force: false },
      { id: newWaiver.id, in_force: true },
    ])
  })
})
