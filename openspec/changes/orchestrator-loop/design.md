## Context

See proposal.md — Why. The constraints that shape the approach:

- The pieces below the loop already exist and fix its seams: `@specmate/workspace` provisions a
  worktree per task and commits per stage, `@specmate/runner` executes one dispatched stage and
  returns a parsed `StageOutcome`, and the schema already carries pinned run graphs
  (`run_graphs`, versioned per task), idempotent stage attempts (`graph, node, attempt` unique),
  and one row per review round (`task, loop, round` unique). The loop orchestrates these; it
  does not reimplement any of them.
- `packages/core` currently hardcodes the feature lifecycle as a transition table in `state.ts`.
  That table is the thing this change turns into data; the interrupt states around it
  (`waiting_human`, `paused`, `blocked`, `cancelled`, `failed`) and their re-entry rules are
  type-independent and stay.
- The persistence spec requires every fixed value set to be a database enum. Task status is one,
  and pipeline positions must land in it somehow — this is the one real tension between
  "pipelines are data" and "closed sets are enforced by the database".
- One server, one orchestrator process, one owner. Concurrency exists across tasks, never within
  one: a task has at most one stage in flight, by design and by spec.

## Goals / Non-Goals

**Goals:**
- Adding the incident pipeline later is a catalog entry, a status-enum migration, and prompts —
  zero engine edits. That is the acceptance test for "generic".
- A `kill -9` at any instant loses at most the in-flight stage attempt, never the task: after
  restart the store alone says what runs next.
- Every transition is explainable after the fact from Postgres: which node, which round, which
  attempt, which verdict, who approved.
- Testable without containers or credentials: the engine drives the runner interface, and tests
  drive the engine with the stub provider from the claude-runner change.

**Non-Goals:**
- Scheduling fairness across many tasks — first-runnable-wins is fine for a single owner.
- Reattaching to a stage that was running when the orchestrator died (see decision below).
- Any surface for humans beyond programmatic gate operations; cards and UI are Phase 2.

## Decisions

### Definitions live in `packages/core` as typed data, not in the database

A pipeline definition is a TypeScript object: an ordered list of nodes — `stage` nodes carrying a
role and a provider-binding rule, `gate` nodes carrying their allowed resolutions (approve
target, redirect target with its cap identity, rework targets) — plus loop edges on review
stages naming the loop identity whose cap bounds them, and a terminal outcome. The catalog maps
task type → definition.

In the repository, not in Postgres, because definitions must be reviewed the way role prompts
are: through an OpenSpec change, with types and tests, shipped by deploy. The database holds
*instantiations* — the pinned copy in `run_graphs.dag` — never the source. A runtime-editable
catalog was rejected: nothing edits it (no UI for this exists or is planned soon), and it would
put the source of truth for behavior outside code review.

Validation runs at module load and fails the process: every node key unique, every role in the
catalog, every loop edge pointing strictly backwards, every gate resolution naming a reachable
node, exactly one entry node, a terminal reachable from every node. The "reviews go backwards,
never forwards" invariant becomes a structural property a definition cannot violate, rather than
a rule the engine remembers to check.

### Task status stays the fine-grained enum; node keys are status values

The alternative was a coarse status (`running`, `waiting_human`, …) plus a current-node column.
Rejected for now: it is a migration, a rework of `resume_status`, and a change to everything
that reads status — for no Phase-1 behavior. Instead, a stage node's key IS a `task_status`
value: the pinned graph says which of the enum's values this task can visit and in what order.
Startup validation asserts the catalog's node keys are a subset of the enum and fails fast
naming any that are missing.

The accepted consequence: a future pipeline adds its node keys to the enum by migration. That is
the right weight — a new pipeline is an OpenSpec change with a review anyway, and the database
keeps enforcing the closed set the persistence spec demands. `canTransition` becomes
graph-derived: legal moves are the pinned graph's edges plus the unchanged interrupt rules.

### The loop is a poll over Postgres, not a job-queue dependency

Every tick: select tasks whose status names a stage node and which have no stage in flight,
take a per-task advisory lock, dispatch up to the configured concurrency. Graphile Worker /
pgboss were considered and rejected for v1, as the plan already leans: stages run for minutes,
so seconds of poll latency are invisible, and the queue's real features — fan-out, priorities,
multi-worker — are exactly what a one-owner, one-process orchestrator does not have. The
advisory lock still makes an accidentally-started second orchestrator harmless rather than
corrupting, which is cheaper than assuming it never happens.

### Advancing is a pure function of graph, outcome, and stored rounds

`advance(pinnedGraph, node, outcome, rounds, caps) → transition` — no I/O, exhaustively
testable. Approve follows the forward edge. Revise looks at the loop identity's used rounds: if
another round fits the cap, record the round and follow the loop edge; if not, park awaiting a
human. Escalate parks. A non-review stage simply advances on success. The engine around it does
only I/O: read state, call the function, write the transition and the event.

Rounds are recorded in `iterations` on every review completion, verdict included, so the
repeated-findings detector in Phase 2 reads history that already exists. Round numbers come from
the store, and the unique constraint is the arbiter if a crash makes the engine try to record
the same round twice.

### A stage lost to a restart is killed, discarded, and re-dispatched

When startup finds a stage recorded `running`, the container behind it may be gone, finished, or
still running — and the runner's stdout capture is unrecoverable in every case. Reattaching was
rejected: the result contract makes re-running safe by construction (fresh context, discard
before retry), while reattaching needs container introspection for a payoff of one saved run.
So: kill any container labeled with the stage's task and attempt, discard the workspace, mark
the attempt failed with a reason of `orphaned`, and re-dispatch as the next attempt under the
same cap. Runner containers get a label carrying task, node, and attempt precisely so this sweep
can find them.

The cost — a restart mid-stage pays for the lost run again — is accepted for a single owner and
recorded on the attempt, so the ledger shows the money went somewhere.

### Two retry layers with distinct jobs, and one cap

The runner already retries once *inside* a dispatch for a missing or malformed result, per
agent-contracts. The engine counts *dispatches*: a failed dispatch (timeout, scope violation,
non-zero exit, orphaned, or the runner's retry also failing) is discarded and re-dispatched
until the per-stage attempt cap (default 2) is spent, then the task moves to `failed` naming
the stage and the last reason. `failed` is already restartable by spec, so a human can restart
after fixing the cause; nothing loops forever and nothing fails silently.

### Gate operations are the API the UI will call, shipped before the UI

`approve`, `redirect`, and `rework` are orchestrator operations validating against the pinned
graph: approve follows the gate's approve edge; redirect follows its redirect edge and counts
against its cap identity; rework re-enters at one of the gate's declared rework targets with
fresh round counters, per the lifecycle spec. Parked escalations get the matching `resume`. All
four write events naming the acting identity. Phase 2 wraps these in decision records and cards;
it must not need new transitions, only new callers — that is the test of whether the gate
semantics were really finished in this change.

For Phase 1 they are callable from a small admin entry point in the orchestrator, the same
pattern as the runner change's single-stage manual path.

### Telemetry records what ran, not what was configured

The engine persists, per attempt, what the runner's telemetry envelope reports: the model that
actually served the run (not the model configuration asked for — a provider-side substitution is
exactly what a debug chart must be able to show), timing, token counts under the provider's own
keys plus a small normalized core (input, output, cache, cost), and the raw envelope for
anything the normalization did not anticipate. Absent is `null`, never `0`: the future chart
must distinguish "no data" from "free". Nothing aggregates here — the rows are the raw material,
and aggregation is a query the UI change writes.

### Terminal housekeeping is the engine's, not a stage's

Archive and cancel release the task's workspace (the mirror keeps the branch, so nothing is
lost), and the feature definition's v1 terminal is the final gate approving straight into
`archived` — the publish node arrives with Phase 6 as a definition edit. Housekeeping lives in
the engine because a definition should say *what* the terminal is, never own cleanup that every
pipeline needs identically.

## Risks / Trade-offs

- **Catalog ⊆ enum is a coupling that fails at a distance** → validated at startup with an error
  naming the missing enum values and the migration to write; it cannot fail mid-task.
- **Zombie containers if the label sweep misses** → labels are set by the same code that builds
  the argument vector, and the sweep logs what it killed; the runner's own wall-clock timeout is
  the backstop for anything that escapes.
- **Advisory locks are session-scoped** → held on the orchestrator's dedicated connection; if
  the connection drops, the lock drops with it and the poll re-acquires — worst case a tick of
  idleness, never two dispatchers on one task.
- **A pure `advance` invites putting policy in two places** → the rule is stated in code review
  terms: the engine may not branch on role, type, or node key; anything that wants to must
  become definition data. The incident phase will be the audit of whether this held.
- **Fine-grained statuses leak pipeline vocabulary into a global enum** → accepted consciously
  (see decision); revisit only if two pipelines genuinely need the same key with different
  meanings, which node-key naming discipline can avoid indefinitely.

## Migration Plan

No schema migration. New orchestrator environment: poll interval, stage concurrency, per-stage
attempt cap — validated at startup like the existing settings. Deploy is a restart; there are no
production tasks mid-flight in Phase 1, and even with them the restart path *is* the recovery
path being shipped. Rollback is a revert — the schema is untouched and events are append-only.
