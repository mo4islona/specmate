## Why

The pipeline cannot currently keep a rule it was built for: no PR leaves it verified by unit
tests alone. The verifier extends whatever harness a repository has — but nothing ever asks
whether that harness can carry the work at all. A task against a subsystem with no
state-level tests walks the whole pipeline and comes out the far end with a verification
report that proves very little, and nobody was told.

The pieces are staged and idle. `tasks.harness_status` has held
`unknown | adequate | partial | missing | waived` since Phase 0 and is only ever `unknown`; the
ledger prints it to every stage; `tasks.blocked_by` is an array nothing writes; `blocked` is a
task state the engine already refuses to dispatch from and nothing ever enters. The in-flight
`verifier-stage` change names this gap explicitly as the Phase-2 harness probe's job, and
`kickoff-brief` builds the ⚠ key-points block whose first mandatory content this is.

This change makes the question load-bearing: planning classifies coverage for the area the task
touches, a gap becomes a warning the brief cannot omit and a choice the owner makes on the card,
and choosing to build the harness first turns one task into two with a real dependency between
them.

## What Changes

- **Planning probes and classifies.** The planning stage looks for what could actually exercise
  the work — end-to-end suites, integration tests against real dependencies, simulators, state
  fixtures — and classifies coverage for *the area the task touches*, not the repository as a
  whole. A repository with an excellent API harness and nothing for its ingestion path is
  `missing` for an ingestion task.
- **The classification is data, not prose.** It comes back in the stage's result, the way a
  review verdict does, and lands on the task. The brief states it for the human; the engine
  never parses the brief to find it.
- **A gap is a warning the brief cannot omit.** Partial or missing coverage forces the warning
  into the brief's key points, and the mechanical brief check refuses a brief that leaves it
  out — the failure mode being prevented is the silent one, where a brief with no warning reads
  as "nothing to worry about". A brief never reaches the gate while coverage is unknown.
- **The owner chooses on the card**: split the harness work into its own task this one waits on,
  proceed accepting the risk, or cancel. Approving the gate without choosing is proceeding, and
  it is recorded — the acceptance becomes the task's durable `waived` coverage, not an
  inference from decision history.
- **A split is a real dependency.** Choosing it creates a harness task on the same repository
  carrying the probe's evidence as its request, and this task waits on it: nothing is dispatched
  while it waits, it re-enters its pipeline from the start when the blocker lands — so coverage
  is judged again against the harness that now exists — and a blocker that is cancelled or fails
  raises the waiting task to the human instead of stranding it.
- **Waiting on another task becomes a lifecycle rule**, not a harness-specific one: Phase 4's
  cross-repo fixes will use the same dependency, so `blocked` is specified where the other
  states are.
- **A waiver travels to the end.** Every later stage's ledger states it, the task view shows it,
  and the summary says the work was verified without a state-level harness.

## Capabilities

### New Capabilities

- `harness-coverage` (REQ-1401–REQ-1405): what the probe judges and how it is recorded, the
  warning a gap forces into the brief, the choice the owner makes and the durable waiver it
  produces, what a split creates, and how a waiver stays visible to the end.

### Modified Capabilities

- `agent-contracts`: REQ-110 — a role the catalog declares as probing SHALL return its coverage
  assessment as structured result data, and a probing result without one is invalid. The
  parallel to REQ-104's review verdict is exact: the semantics live in their own capability,
  the contract lives here.
- `task-lifecycle`: REQ-615 — a task may wait on another task. Not dispatched while waiting,
  released into its pipeline's entry when the blocker completes, raised to the human when the
  blocker dies. Entering that state joins parking and pausing as a generic interrupt.

## Impact

- `packages/core`: the coverage assessment in `StageResult`, the `probesHarness` role flag, and
  the brief check gaining its harness rules — pure functions, no I/O.
- `packages/db`: no migration. `harness_status`, `blocked_by`, and the `blocked` status all
  exist; only `canTransition` learns that `blocked` is enterable like any other interrupt.
- `apps/orchestrator`: record the classification from a planner result, raise the choice as a
  decision with options, act on the answer — create the harness task and the dependency, or
  record the waiver — and release waiting tasks when a blocker reaches its terminal.
- `roles/planner.md`: what to probe for, how to classify, and the mandatory warning; a
  one-line addition to `roles/summarizer.md` for the waiver.
- `apps/web`: the coverage state on the task view.
- Ordering: after `kickoff-brief` (REQ-1402 layers a conditional part onto REQ-1302's brief and
  REQ-1303's check) and therefore after `decision-records` (the choice is a decision with
  options and discussion, and approving without choosing rides its dismissal path) and
  transitively after `task-qa`. Its `agent-contracts` delta
  ADDs REQ-110, colliding with neither `task-qa`'s REQ-102 nor `verifier-stage`'s REQ-104; its
  `task-lifecycle` delta ADDs REQ-615 while `task-qa` MODIFIES REQ-613, so neither delta
  overwrites the other.

## Non-goals

- **No change to what verification does.** How the verifier behaves on a waived task — a
  scenario it cannot exercise surfaces as uncovered or as a decision — is `verification`'s
  contract and stays as `verifier-stage` wrote it. This change decides whether the work should
  start, not how it is proven.
- **No harness quality judgement.** The probe classifies coverage of an area, not whether the
  tests that exist are good. A repository whose e2e suite asserts nothing is a problem the
  reviewer and the verifier's traceability check are there for.
- **No automatic split.** The split is always the owner's choice on the card; the system
  recommends nothing and creates nothing without an answer.
- **No dependency graph.** One task waits on the tasks named in its blocker list; there is no
  scheduling across a fleet, no priority, no cycle detection beyond refusing a task to block
  itself. Cross-repo task chains are Phase 4.
- **No PR badge.** The waiver reaches the summary as prose; putting it on a pull request
  description is Phase 6's publishing work.
- **No re-probe mid-flight.** Coverage is judged in planning. A task that discovers a gap during
  implementation raises a decision like any other; it does not reclassify itself.
