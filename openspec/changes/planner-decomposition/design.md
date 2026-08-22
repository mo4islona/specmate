## Context

Three things in the pipeline decide the shape of a task's run, and none of them is the planner:

1. `PIPELINE_CATALOG[type]` fixes twelve nodes at creation, before anything has read the
   repository.
2. `Engine.splitHarnessTask` turns one owner click into a new task, writing its title and
   description itself from the probe's `evidence_md`.
3. Nothing bounds either. `Caps` bounds loops, redirects and repeated findings; `Budgets` bounds
   cost and wall clock. Task creation has no cap at all.

The observed failure is a chain: task → harness task → harness-of-harness task, each blocked on
the next, each with its own fresh budget. The classification driving it is correct every time —
the harness genuinely does not exist yet — so no prompt change can fix it. The branch is
deterministic and lives in the engine.

The planner is the only role that reads the repository before a plan exists, and it already
judges the size of the work: `## Size` is a required section of the brief. Nothing reads it.

## Goals / Non-Goals

**Goals**

- The planner states the shape of the work: how big it is, and what must land first.
- The engine bounds that shape — depth, count — deterministically, not by asking a prompt nicely.
- A small task runs fewer stages than a large one.
- A chain is traceable: any task can say where it came from and how deep it sits.

**Non-Goals**

- Scaling caps or budgets by size (see the proposal's non-goals: caps are resolved at creation
  and recorded as what the task ran with; re-resolving them mid-run is a separate argument).
- A chain-wide budget ceiling.
- Ordering or dependencies among a plan's prerequisites.
- Cross-task memory of owner answers — that is the `decision-floors` change.

## Decisions

### The plan is data on the result, not prose in the brief

`plan` joins `harness_coverage` as a top-level field of `RESULT.json`, required from a role whose
contract declares it, checked at parse time exactly as the coverage assessment is. The brief still
carries `## Size`, but the brief is now the rendering and the result field is the source. The
alternative — parsing the size out of the brief's prose — is the thing REQ-1401 already forbids
for coverage, and for the same reason: a rendered document is not a data channel.

`size` is an enum of three values rather than a number of iterations. Three coarse buckets are
something a planner can be consistent about across runs; "this needs 7 iterations" is not.

### A prerequisite is a proposal, not an action

The planner cannot create a task, and this change does not give it that power. It returns a list;
the owner chooses at the kickoff gate whether it becomes tasks. This keeps the existing shape of
authority — agents propose, the owner disposes, the engine executes — and it means a bad plan
costs a gate click, not a chain of runs.

The list is flat and unordered. Everything in it blocks the proposing task; nothing in it blocks
anything else. Nested plans are how the recursion got in; a flat list one level deep cannot
recurse by construction.

### One decision, generalized, keeping its key

Today's coverage decision (`human_kickoff_gate`, key `harness-coverage`) already offers exactly
the three options this change needs. Rather than raise a second card for prerequisites, the
existing one is raised when *either* coverage is short of adequate *or* the plan proposes
prerequisites, and its prompt renders whichever of the two applies.

The key stays `harness-coverage` even though the decision is now broader than coverage. Changing
it would orphan every open decision in a live database — the engine matches by `(nodeKey, key)`
and would stop recognising its own card. The key is an internal identifier; the prompt says what
the decision is. This is recorded here so the name is understood as history rather than as scope.

### Splitting is bounded by depth, and the bound is in the engine

`max_plan_depth` (default 1) means: a task the owner launched may split; a task created by a split
may not. `applyCoverageChoice` never sees a `split` option for a task at the cap, because
`coverageOptions()` does not offer one — the option list is computed from the task's depth, not
filtered after the fact. The prompt states why the option is absent.

The default of 1 is deliberate. It is the smallest value that keeps the feature (a task can say
"build the harness first") while making the observed three-deep chain impossible. Raising it is a
per-task cap override, which the owner already has for every other cap.

`max_prerequisite_tasks` (default 2) bounds the width. Entries past the cap are named in the
decision prompt as dropped. A silently truncated list reads as "the plan was small", which is the
failure mode the whole note in `docs/autonomy-gaps.md` is about.

### Profiles are subsequences, validated at load

A profile is a `PipelineDefinition` whose node list is a subsequence of a base definition's, with
the same terminal, in which no surviving node references a dropped one. Both properties are
checked when the catalog loads, so a reduction that breaks its own graph is a failed deploy rather
than a stuck task — the rule REQ-402 already applies to definitions.

Two alternatives were rejected:

- *Per-task node removal.* REQ-404 says an instantiated graph contains exactly its definition's
  nodes and that per-task variation may not add, remove, or rewire nodes. Reducing at the
  definition level keeps that invariant intact: the task still runs exactly one definition, just
  not always the same one.
- *A separate task type per size.* Types are the vocabulary the owner launches with (`feature`,
  `bugfix`); size is a judgement made after reading the repository. Making the owner pick
  `feature-small` at intake asks them the question this change is trying to answer for them.

The compact profile drops `kickoff_brief` and `spec_review`:

- `kickoff_brief` is the planner running a second time on the file it just wrote. Both nodes are
  checked against the same required parts (REQ-1303 applies to *any* planner run that wrote the
  proposal), so planning's own output is already a complete brief. For a small task the second
  pass buys polish and costs a full provider run.
- `spec_review` is a cross-provider review of a spec that, for a small task, is a few scenarios.
  Both human gates around it survive: the owner still approves the spec before code is written.

`code_review`, `verify` and `summarize` stay in every profile. The code is what ships.

### The profile swap happens once, at the end of planning

The graph is pinned at creation (REQ-403) and the size is not known until planning has run — so
the pinned graph is necessarily wrong for a compact task until the plan lands. Rather than delay
pinning, the engine appends a new run-graph version at the moment the plan is recorded, inside the
same transaction that commits the planning stage, and computes the stage's forward transition
against the new graph. The task therefore leaves `planning` for whatever node the new graph puts
next: `kickoff_brief` under the full profile, `human_kickoff_gate` under the compact one.

Appending rather than mutating is REQ-403's own rule, and it is what makes the swap auditable: v1
and its stage history stay readable next to v2.

The swap is idempotent by construction — it happens only when the profile the size selects differs
from the profile the current graph names, so a re-planned or restarted task does not accumulate
versions.

### Lineage is two columns, not a table

`origin_task_id` and `plan_depth` on `tasks`. A chain is reconstructed by following
`origin_task_id`; the depth is denormalised so the cap check is a column read rather than a
recursive walk. `blocked_by` already carries the other direction (what a task waits on) and is
unchanged.

## Risks / Trade-offs

- **A planner that lowballs the size gets a thinner pipeline.** A "small" that was actually medium
  loses its spec review. Mitigation: the owner sees the declared size in the brief and at the gate,
  and a redirect at the kickoff gate re-runs planning. The blast radius is bounded by the two human
  gates that no profile drops.
- **The compact profile makes planning's draft the final brief.** It is checked for every required
  part, but it is the rough pass. Accepted for `small`; this is exactly the trade the size
  declaration exists to make.
- **The plan is only as good as the planner.** A planner that proposes prerequisites for
  everything turns every task into a chain of two. The count and depth caps bound the damage to
  `max_prerequisite_tasks` tasks, one level deep, and every one of them costs an explicit owner
  click at the gate.
- **`plan_depth` is denormalised.** A prerequisite created outside `createPlannedPrerequisites`
  would carry depth 0 and be offered a split. Only one code path creates a task from a plan, and
  it sets both columns together; the risk is a future second path forgetting to.
- **The decision key outlives its name.** `harness-coverage` now identifies a decision that may
  have nothing to do with the harness. Recorded above as a deliberate trade against orphaning open
  decisions in a live database.

## Migration Plan

One additive migration: three nullable-or-defaulted columns on `tasks` (`origin_task_id uuid`,
`plan_depth integer not null default 0`, `plan_size` nullable). No backfill — an existing task has
no declared size and depth 0, which is exactly right for a task launched by the owner.

Tasks in flight keep the run-graph version they were pinned to. A task that has already passed
`planning` never records a plan and therefore never swaps profile; it finishes on the full
definition. A task that has not yet reached `planning` picks up the new behaviour on its next
stage.

The two new caps need one more statement in the same migration. `tasks.caps` is stored as jsonb
and read back without a schema parse, so a row written before this change would answer `undefined`
to a depth-cap check — the one shape that must never be undefined, since it is what closes the
recursion. The migration therefore merges the new keys into every existing row's `caps`
(`caps || '{...}'::jsonb`) alongside the column-default change, so a pre-existing task is bounded
exactly like a new one.
