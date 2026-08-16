## Context

See proposal.md — Why. What already exists and fixes the seams:

- The engine (in-flight `orchestrator-loop`) advances review-shaped stages on the verdict in
  the parsed result and records each round with its findings; the feature definition already
  places verify between implement and code review with a loop edge back to implement under the
  impl cap. The engine may not branch on role or node identity, so nothing verifier-specific
  can live there.
- `packages/core` already carries the verifier's role contract (reads spec/design/tasks,
  writes `verification`, `writesCode: true` — which derives its container runtime) and a
  `StageResult` whose optional `verdict` is currently annotated "reviewer-only".
- `packages/runner`'s executor already does post-run enforcement the same shape this change
  needs: it checks the write scope against the role contract before the outcome is accepted.
- `roles/verifier.md` exists but tells the agent the verdict lives in `verification.md` —
  the desync this change closes.
- Toolchains are pinned per task and the docker socket follows `writesCode`
  (`execution-environment`, archived `runner-toolchains`), so the harness can actually run
  headless; nothing here touches execution plumbing.

## Goals / Non-Goals

**Goals:**

- The engine needs zero edits: everything verifier-specific lands in the role catalog, the
  result contract, and the executor's post-run checks.
- The corroboration is pure functions over two strings (the specs, the report) — exhaustively
  testable without containers, providers, or a database.
- The incentive structure is explicit: an honest `revise` is accepted and committed; a sloppy
  or dishonest `approve` fails the attempt and forfeits the run. Lying is the expensive path.

**Non-Goals:**

- Judging harness quality. The check proves coverage and outcomes were reported from real
  runs; whether the assertions are strong is the cross-provider code reviewer's job (it reads
  `verification` and the diff already) and, later, the Phase-2 harness probe's.
- Any counting of in-stage harness retries — the flaky-run policy stays a prompt instruction.

## Decisions

### IDs stay within capability bands

The house standard (the `openspec-standard` skill) assigns stable requirement and acceptance
IDs from each capability's reserved band. This change retains REQ-104 and its existing
AC-110/AC-111 scenarios in `agent-contracts`, allocates AC-121/AC-122 as that capability's next
acceptance IDs, and gives the new `verification` capability REQ-1101–REQ-1105 and
AC-1101–AC-1111. These IDs are immutable and never reused.

### The verdict lives in RESULT.json; verification.md is evidence

The engine parses results, not prose, so the verifier returns `verdict` and `findings` in
`RESULT.json` exactly like the reviewer — `StageResult` already has the fields; the
"reviewer-only" annotation goes, replaced by a role-contract flag (`returnsVerdict`) set for
reviewer and verifier. Result validation rejects a verdict-less result from a role that must
return one, which routes it into the existing invalid-result flow (one retry, then
escalation). The alternative — parsing the verdict out of `verification.md` — was rejected:
it makes the report do two jobs and puts a prose parser on the critical path of every
transition.

### Corroboration runs in the executor, declared by the role catalog

The cross-check happens where the write-scope check already happens: in the runner's executor,
after the run, before the outcome is accepted and anything is committed. Which roles get
corroborated is a role-contract declaration, not a `role === 'verifier'` branch — the executor
stays generic the same way it derives the docker socket from `writesCode`. Running the check
in the orchestrator was rejected: the engine may not branch on role, and the executor already
holds the workspace at the right moment (a failed corroboration must fail the attempt before
its work is committed, so the discard-and-retry contract applies unchanged).

### Scenario identity is the header text; the inventory comes from the change folder

The scenario inventory is every `#### Scenario:` header across the change folder's
`specs/**/*.md`, keyed by exact header text — when a repo's specs carry house-standard `AC-n`
IDs in their headers, the ID rides along in that text — and it is what REQ-1104's finding
identifiers derive from when present.
Duplicate header text within one change collapses to one scenario. No cross-repo or main-spec
scenarios: verification proves the delta the task is shipping, which is what its specs
declare.

### The matrix is a markdown table under a fixed heading

`verification.md` stays a readable document with one machine-checkable region: a table under
a `## Matrix` heading with columns for scenario, covering assertion, and executed outcome
(`pass` / `fail` / `uncovered`), one row per scenario-assertion pair. Evidence — command
lines, output excerpts for failures — lives in ordinary prose sections around it; full logs
stay in the runner scratch, not the artifact. A table the parser cannot read is an invalid
result (retry, then escalation), so the role prompt carries an exact example. A separate
machine file (JSON next to the report) was rejected: two artifacts describing one run will
drift, and the table is the part a human wants to read anyway.

### Scenario findings are derived from the report, not trusted from the agent

On a non-approve outcome, the executor derives one finding per failing or uncovered scenario
from the parsed matrix — identifier deterministic from the scenario's header text — and
merges the agent's own findings around them. The recurrence guarantee ("same scenario, same
identifier, next round") then holds by construction instead of by prompt discipline, which is
what lets the Phase-2 repeated-findings detector trust verification rounds. A `revise` whose
derived-plus-returned findings come out empty is an invalid result — a revise with nothing to
act on gives the implement round nothing.

### The rewritten role prompt states the contract, not the enforcement

`roles/verifier.md` gets the verdict-in-result shape, the exact matrix format, the run-twice
instruction for a failing assertion (report only what failed twice), and the rule that
unverifiable means uncovered plus a decision request when a human must weigh in. It does not
explain the corroboration machinery — the prompt asks for honesty; the executor makes
dishonesty unprofitable.

## Risks / Trade-offs

- **A failed corroboration discards real harness work** (discard-before-retry applies to the
  whole attempt) → accepted: it only triggers on an uncorroborated approve, the retry re-runs
  with fresh context, and the forfeited run is the deterrent working as designed.
- **Matrix parse fragility against agent-formatted markdown** → the parser is tolerant of
  alignment and column whitespace, strict about the heading and column set; fixtures cover
  the ways tables actually come out of providers; the invalid-result flow caps the damage at
  one retry plus escalation.
- **Scenario headers renamed by a later spec edit change finding identifiers** → accepted:
  a renamed scenario is a different obligation, and resetting recurrence detection on rename
  errs toward another round rather than a premature escalation.
- **The verifier can still write weak assertions that pass** → out of scope here by design;
  the cross-provider reviewer audits the harness diff with the report in hand (it reads both
  today), and the Phase-2 probe adds the adequacy dimension.

## Migration Plan

No schema migration and no new environment. The role-prompt rewrite ships in the same deploy
as the executor check — the old prompt against the new validation would fail every verify
stage, so they must not be split. Rollback is a revert of both together.
