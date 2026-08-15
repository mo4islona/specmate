## 1. Schema definition

- [x] 1.1 Create `packages/db` with Drizzle and a snake_case casing convention (verify: `bun run --cwd packages/db typecheck`)
- [x] 1.2 Define enum types for every closed set in the domain (verify: `packages/db/src/schema.ts`)
- [x] 1.3 Define `provider_credentials` and `tasks`, with a unique slug and resolved caps/budgets defaults
- [x] 1.4 Define `run_graphs` and `stages`, with `(graph_id, node_key, attempt)` unique
- [x] 1.5 Define `iterations` with `(task_id, loop, round)` unique
- [x] 1.6 Define `decisions` with a stable key and an index over open decisions
- [x] 1.7 Define `artifacts` with `(task_id, path)` unique, holding the git object and a display snapshot
- [x] 1.8 Define `skill_sources`, typing `inject_into` as an array of the role enum
- [x] 1.9 Define `pull_requests` with a unique URL
- [x] 1.10 Define `feedback`, carrying role, provider, and the prompt versions in force
- [x] 1.11 Define `events` with a `bigserial` cursor and an index on `(task_id, seq)`
- [x] 1.12 Set cascade behaviour: cascade from tasks, `set null` from stages

## 2. Connection and migrations

- [x] 2.1 Provide a connection factory over Bun's Postgres driver, configured from the environment (verify: `packages/db/src/index.ts`)
- [x] 2.2 Provide a `ping` helper the health probes use (verify: `/readyz` reports the database)
- [x] 2.3 Add the drizzle-kit config and generate the initial migration (verify: `packages/db/drizzle/0000_init.sql` exists)
- [x] 2.4 Add a migration runner usable both locally and as the Compose one-shot job (verify: `bun run db:migrate`)

## 3. Shared vocabulary

- [x] 3.1 Define the closed sets and cap/budget defaults in `packages/core` so schema and application code agree (verify: `packages/core/src/state.ts`)
- [x] 3.2 Type the JSONB columns against the `packages/core` types (verify: `bun run typecheck`)

## 4. Verification

- [x] 4.1 Apply migrations to an empty Postgres 18 and confirm every table exists (verify: `\dt` lists 11 tables)
- [x] 4.2 Confirm re-running the migration runner is a no-op (verify: second `bun run db:migrate` succeeds)
- [x] 4.3 Round-trip a task through the API and read back its default caps and budgets (verify: `bun test`)
- [x] 4.4 Add the CI guard that fails when regeneration produces a diff (verify: `.github/workflows/ci.yml`)
