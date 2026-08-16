## Why

The Verifier stage v0 is the last unwritten piece of Phase 1 in `docs/plan.md`: every other
bullet of the walking skeleton has a change — workspace manager, runner, and toolchains are
archived; the orchestrator loop and the task surface are in flight. The pieces around
verification even assume it already works: the pipeline definition places a verify node
between implementation and code review with a loop edge back to implementation, the reviewer's
contract reads the `verification` artifact, and the verifier role exists in the catalog with
its prompt, its write permission, and — derived from it — its container runtime.

What is missing is the contract that makes the stage honest. Two gaps, one of them a live
desync: the role prompt today says "the verdict lives in `verification.md`" — prose the engine
cannot act on, while the orchestrator loop advances review-shaped stages on a machine-readable
verdict; and nothing enforces the plan's rule that scenario→assertion traceability is checked
mechanically rather than trusted to the agent (§6: no PR leaves the pipeline verified by
claims alone).

## What Changes

- A `verification` capability: the verify stage judges the implemented change by executing a
  harness against it, produces a report in the change folder mapping every scenario in the
  change's specs to executed assertions and their outcomes, and its evidence is what the code
  reviewer and the human later read.
- The traceability check becomes mechanical: after a verifier run, plain code — no agent —
  cross-checks the committed report against the change folder's specs. An `approve` verdict
  that the evidence does not corroborate (a scenario unmapped, missing from the report, or
  mapped only to a failing assertion) fails the stage attempt instead of advancing the task.
- The verdict moves where the engine can see it: the verifier's result carries
  `approve`/`revise`/`escalate` exactly like the reviewer's, with findings keyed stably by the
  scenario they fail so a recurrence across rounds is detectable. `roles/verifier.md` is
  rewritten to match — this closes the desync named above.
- The report format gains just enough structure to be machine-checkable while staying a
  readable document: a matrix of scenario, covering assertion, and executed outcome, with
  enough run output that a human audits a failure without re-running anything.
- Failing verification loops back to implementation under the impl cap — that walk is already
  the orchestrator loop's; this change supplies the verdicts and findings it consumes.
- The change's delta specs follow the house ID discipline (the `openspec-standard` skill this
  repo ships): requirements and scenarios retain immutable capability-banded IDs, while the
  new `verification` capability claims its own band.

## Capabilities

### New Capabilities

- `verification`: what the verify stage must do (REQ-1101–REQ-1105) — execute the harness rather
  than read the code, report every scenario's outcome in a mechanically checkable matrix,
  corroborate any approve verdict against that evidence, and surface what it cannot verify
  instead of skipping it.

### Modified Capabilities

- `agent-contracts`: the review verdict contract — REQ-104 widens from the reviewer alone to
  every reviewing stage: the verifier's result
  carries the same verdict and stable-finding shape, and a reviewing stage's result without a
  verdict is an invalid result, not a silent pass.

## Impact

- `packages/core`: a verification module — extract the scenario inventory from a change
  folder's specs, parse the report's matrix, and cross-check the two; result validation
  learns that reviewer and verifier results must carry a verdict.
- `packages/runner`: the executor corroborates a verifier `approve` against the committed
  report before accepting the outcome, the same post-run posture as the existing write-scope
  check; which roles get corroborated is declared in the role catalog, not hardcoded in the
  executor.
- `roles/verifier.md`: rewritten for the verdict-in-result contract, the matrix format, and
  findings keyed by scenario.
- No schema migration: the `verification` artifact kind, the verdict enum, findings, and
  per-round records all exist.
- Sequencing: depends on the in-flight `orchestrator-loop` change for verdict-driven
  advancement, loop edges, and recorded rounds; its `agent-contracts` delta touches a
  different requirement than `task-qa`'s, so the two changes do not constrain each other's
  archive order.

## Non-goals

- No harness-adequacy classification and no task splitting. Judging whether a repo's harness
  can carry the scenarios is the Phase-2 harness probe; in v0 the verifier extends what
  exists, and a scenario it cannot exercise surfaces as an uncovered scenario or a decision —
  never as a silent pass.
- No repeated-findings escalation. Stable finding identifiers make the recurrence detectable;
  acting on it is the Phase-2 detector, per the orchestrator-loop non-goals.
- No mechanized flaky-run policy. The role prompt instructs re-running a failed assertion
  once before reporting it; distinct failures loop back under the impl cap through the normal
  verdict. Nothing in the system counts in-stage retries.
- No spec-format lint. Validating produced specs against the house standard is the Phase-2
  skill-sync work (`docs/plan.md` §11.3); this change checks coverage, not format.
- No changes to the pipeline definition, the engine, or the schema — the verify node, its
  loop edge, and the round records ship with `orchestrator-loop`.
