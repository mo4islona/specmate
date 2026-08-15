## Why

Phase 1 of `docs/plan.md` ends with a task walking from draft to a reviewed, summarised branch
on its own — and nothing sequences that walk yet. The runner executes exactly the stage it is
handed, the workspace commits what a stage produced, the database can already say which attempt
of which node ran; but which node runs next, what a revise verdict rewinds, when a loop has gone
on long enough, and what happens after `kill -9` are all still unwritten.

There is one design decision worth making now rather than later: the pipeline a task follows is
about to stop being universal. A production incident does not walk research → spec → implement —
it triages and diagnoses, and its output is a diagnosis and a postmortem rather than a PR. That
pipeline arrives soon: read-only incident investigation is Phase 4 of `docs/plan.md`. If the
loop is built as the hardcoded feature state machine, that phase rewrites it. So the loop is
built the other way up: a generic engine that walks a **pipeline definition**, and the
feature/bugfix pipeline is the first entry in a catalog — data, not code. The engine keeps the
type-independent invariants; the definitions say what runs.

## What Changes

- Pipeline definitions as data: a catalog keyed by task type, each definition declaring its
  stage nodes (role plus provider binding), human gates, loop edges with their caps, and the
  terminal outcome. Definitions are structurally validated; a loop edge that points forward or a
  node naming an unknown role is rejected at load, not discovered mid-task.
- The feature/bugfix definition as the catalog's first entry, mirroring the lifecycle spec in
  full: planning, kickoff brief and its gate, research ⇄ spec review under the spec cap, spec
  gate, implement → verify → code review under the impl cap, summarize, final gate. The planner
  prompt does not exist yet, so the planning segment fails loudly if dispatched — the
  kickoff-brief change makes it runnable; the wiki publish node joins in Phase 6. Both are data
  edits, which is the point.
- Pinning: creating a task instantiates its type's definition into the task's run graph, and the
  engine consults only that pinned copy. A definition changed by a deploy does not reshape a
  task already in flight; re-planning writes a new graph version rather than mutating the old.
- The engine itself, in the orchestrator: pick up a runnable task, ensure its workspace, execute
  the current stage through the runner, record the outcome, and advance along the pinned graph —
  approve advances, revise follows the loop edge and counts the round, escalate parks the task.
  No role- or type-specific branching anywhere in it.
- Loop caps enforced from the task's stored caps: a round that would exceed its cap parks the
  task awaiting a human instead of running.
- Stage failure handling above the runner's own single retry: discard, retry up to a per-stage
  attempt cap, then fail the task naming the stage — never silently.
- Stage telemetry recorded for analysis: every attempt keeps the provider and the model that
  actually served it, start and finish times, token usage by kind, and the reported cost —
  queryable per task, so the debug chart of where time and tokens go can be built on it later.
- Restart recovery: on startup every non-terminal task resumes from the store alone; a stage
  recorded running with no live execution behind it is treated as a failed attempt and re-run
  under the same attempt cap, updating its record in place rather than duplicating it.
- Gate mechanics without a UI: a gate node parks the task; approve, redirect, and rework are
  orchestrator operations invoked programmatically for now — the Phase-2 decision cards and the
  UI call these same operations rather than adding new transitions.
- `packages/core`'s hardcoded transition table becomes derived: legal transitions come from the
  pinned graph plus the generic interrupt states, and the old table survives only as the
  expected rendering of the feature definition in tests.

## Capabilities

### New Capabilities
- `pipeline-definitions`: what a pipeline definition is — its nodes, gates, loop edges, caps,
  and terminal outcome — how definitions are validated, how the catalog is keyed by task type,
  and how a task pins its own copy at creation.

### Modified Capabilities
- `task-lifecycle`: legal transitions derive from the task's pinned pipeline instead of one
  fixed table; the engine's walk (advance / loop back / park) is specified against any valid
  definition; stage failure gains a bounded retry-then-fail contract; restart recovery becomes a
  stated requirement rather than a property of the persistence schema.
- `persistence`: stage attempts additionally record execution telemetry — model, timing, token
  usage by kind, reported cost — with absent telemetry distinguishable from zero usage.

## Impact

- New definition module in `packages/core`: pipeline types, structural validation, the catalog
  with the feature/bugfix entry; `state.ts` transitions become graph-derived, interrupt and
  terminal states unchanged.
- `apps/orchestrator` gains the loop: a Postgres-backed scheduler over runnable tasks, wiring
  `@specmate/workspace` (provision, commit, discard) and `@specmate/runner` (execute) per stage,
  plus the programmatic gate operations.
- `packages/db`: the run-graph jsonb type widens to carry gates, loop edges, and caps, and the
  stage cost jsonb widens to a structured usage record (model, token kinds, cost) — jsonb both,
  so no migration; `run_graphs`, `stages`, and `iterations` already carry pinning, attempts, and
  rounds.
- No new services, no Compose changes, no new environment variables beyond the scheduler's poll
  interval and per-stage attempt cap.

## Non-goals

- No decision records, no answer surface, no notifications. Parked tasks are resumed through
  the programmatic gate operations; the Phase-2 decisions change gives them cards and a UI.
- No planner prompt. The planning segment exists in the definition but cannot run until the
  kickoff-brief change writes the prompt; until then manual runs start tasks at research
  through the admin entry.
- No budget enforcement and no repeated-findings detector — Phase 2, as the plan states. The
  engine records rounds and costs; nothing acts on them yet.
- No parallel fan-out. Definitions are linear chains with backward loop edges; executing
  genuinely concurrent nodes is Phase 8+.
- No publication. The feature definition's terminal in this change is the final gate approving
  into archive; the wiki/PR publish node is added to the definition in Phase 6.
- No incident pipeline and no wiki (the system and ops maps) — Phase 4 — and no operator role,
  which is deferred further still. This change's contribution to them is precisely that a new
  pipeline becomes a catalog entry, not an engine change.
- No charts and no aggregation endpoints over the recorded telemetry — this change only makes
  sure the raw material exists and is queryable; the debug chart is UI work.
- No task intake beyond what exists: tasks are created directly in the store; the API/UI path
  is its own Phase-1 change. `blocked_by` scheduling waits for the harness-split work in
  Phase 2.
