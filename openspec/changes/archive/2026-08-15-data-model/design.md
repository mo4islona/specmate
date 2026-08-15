## Context

See `proposal.md` — Why. The table inventory comes from `docs/plan.md` §7; this document
records where the implementation is more specific than that sketch and why.

## Goals / Non-Goals

**Goals:**
- A schema an orchestrator can be written against without further design work in Phase 1.
- Invalid states unrepresentable where the database can cheaply say so.
- Migrations that a human can read in a diff.

**Non-Goals:**
- Query performance tuning. Indexes here cover the access paths the roadmap names; anything
  else waits for a measurement.
- Multi-tenancy. There are no accounts and no ownership columns, by design.

## Decisions

**Enums over check constraints or text.** Postgres enums give the closed set, a stable name in
the dump, and a readable type in `\d`. Adding a value is a migration, which is the point: a new
task status should be a reviewed change. The cost — reordering values is awkward — does not
apply, since nothing depends on enum ordinality.

**`events.seq` is a `bigserial`, not a UUID or a timestamp.** The event log is the UI's stream
and the replay log; both need a total order with a resumable cursor. Timestamps collide and
UUIDv7 sorts only approximately under concurrent writers. A sequence gives an exact
"everything after N" query. Gaps from rolled-back transactions are acceptable — the contract is
ordering, not density.

**Stage identity is `(graph_id, node_key, attempt)`.** Idempotent resume needs a key that is
knowable before the row exists: after a crash the orchestrator must decide "have I already
started this attempt" without having kept a handle. Making the tuple unique lets resume be an
upsert. A surrogate primary key remains for foreign keys.

**Caps and budgets are stored resolved, not sparse.** A task records the limits it actually ran
under. The alternative — merge defaults at read time — makes historical loop counts
uninterpretable the moment a default changes.

**`blocked_by` is a UUID array, not a join table.** Task splits (harness task A blocking fix
task B, §6 of the plan) are the only dependency edges and there are at most a handful per task.
A join table would add a migration and two queries to express a list of two elements.

**Cascade on task, `set null` on stage.** Everything subordinate to a task dies with it.
Feedback and decisions also point at the stage that produced them, but that reference is
informational: losing a stage must not destroy the human signal attached to it, which is the
input to the self-learning flywheel.

**Snapshots are display-only.** `artifacts.snapshot_md` exists so the UI renders instantly
without a git read. Recording the git object alongside it makes staleness detectable instead of
invisible.

**`skill_sources.inject_into` uses the role enum.** The spec-standard skill is injected per role
(§11 of the plan). Typing the column as an array of the role enum means a typo in configuration
fails at write time rather than silently injecting into nothing.

## Risks / Trade-offs

- **Generated migrations can drift from the schema** → CI regenerates and fails on any diff.
- **Enum changes require a migration and cannot be rolled back trivially** → accepted; the
  closed sets here are domain vocabulary, not configuration.
- **An unbounded event log grows without limit** → out of scope for Phase 0; the sequence-based
  cursor makes a later truncation policy straightforward.
- **Storing resolved caps duplicates the defaults across rows** → accepted for auditability.
- **JSONB columns (`dag`, `result`, `findings`) are unvalidated by the database** → their shapes
  are owned by `packages/core` schemas and validated in application code before writing.

## Migration Plan

The initial migration creates the whole schema; there is no prior state. Rollback is dropping
the database volume. Once real tasks exist, forward-only migrations are the rule.

## Open Questions

- Whether the job queue gets its own tables here or brings its own schema with a library. It
  does not affect any table above, so it is safely deferred to Phase 1.
