## Why

Everything SpecMate does must survive a restart: a task half-way through implementation, an
unanswered decision, a reviewer's findings from the previous round. Git stores the artifacts,
but git cannot answer "what is waiting for me right now" or "which prompt version produced
this". Postgres is that durable source of truth, and the schema has to exist before the
orchestrator can be written against it. This is Phase 0 of `docs/plan.md`.

## What Changes

- A Postgres schema covering the full domain: provider credentials, tasks, run graphs, stages,
  loop iterations, decisions, the artifact index, spec-standard skill sources, pull requests,
  feedback, and an append-only event log.
- Enum types for every closed set — task status, agent role, provider, review verdict, decision
  kind, harness status — so invalid states are rejected by the database, not by convention.
- Drizzle as the schema definition, with generated SQL migrations checked in and applied by a
  dedicated one-shot job.
- A CI guard that fails when the checked-in migrations no longer match the schema.

## Capabilities

### New Capabilities
- `persistence`: what SpecMate stores durably, which invariants the store enforces, and how the
  schema is allowed to evolve.

### Modified Capabilities
<!-- None: no existing capability changes behaviour. -->

## Impact

- New: `packages/db` — schema, migration journal, connection factory, migration runner.
- `packages/core` gains the shared enums and cap/budget defaults the schema references, so the
  same closed sets are used by the database and by application code.
- Postgres 18 becomes a hard dependency of CI as well as of the runtime.

## Non-goals

- No queue tables. The job queue arrives with the orchestrator in Phase 1 and may be a library
  that owns its own schema.
- No artifact content in the database beyond a rendered snapshot for the UI — git stays the
  store of record.
- No retention, archival, or compaction policy for the event log (Phase 6 hardening).
- No read models or reporting views; the metrics dashboard is Phase 7.
