## Why

A task against a repository with no specification suite walks three nodes that produce nothing
anybody reads. `specify` writes a specification that cites no identifier and governs nothing after
the task archives; `spec_review` reads it across providers; the specification gate asks the owner
to approve it. Two agent runs and a human interruption, and the artifact they exist to produce is
thrown away at publication, because there is no suite for it to land in.

`2026-08-24-spec-convention-profiles` decided the opposite and REQ-1705 records it: a repository
having no specification is a fact about the repository, never a reduction of the process. That
decision was right about the mechanism and wrong about the price. The mechanism it named is real —
`specify` produces the change's specification, the validating stage builds its scenario inventory
from that specification, and REQ-1103 holds an approve verdict to covering every scenario in it, so
removing the stage makes an approve vacuous. What it did not weigh is that the whole apparatus is
being paid for by a repository that will never read its output.

So this change pays the mechanism's price openly rather than by keeping the stages. Under the
profile `none` the acceptance moves into the kickoff brief — the artifact the owner already reads
and already approves — and validation corroborates against it. Nothing about approve becomes
weaker: it is still every declared scenario covered by an executed assertion, still checked with no
agent judgment, and an empty inventory now fails the stage instead of satisfying it vacuously.

**Roadmap.** Continues the Phase 2 context-sources thread `2026-08-24-spec-convention-profiles`
opened (§2 "Context sources", §14 Phase 2). It is the second half of the same question: that change
taught SpecMate which convention governs a repository, this one lets the pipeline act on the answer.

## What Changes

- **BREAKING** REQ-1705 is removed. Under the profile `none`, `specify`, `spec_review` and the
  specification gate SHALL be **skipped by their own condition** — not dropped from the graph. They
  stay pinned, and every surface renders them as skipped with the reason, the way REQ-409 already
  requires of a conditional stage.
- The spine REQ-602 protects loses its specification segment. Planning, implementation, validation,
  summarisation and publication stay mandatory, and so do the kickoff and final human gates.
  Validation is still never optional.
- A **gate** may now be conditional. Until now only a stage could carry a predicate, because REQ-602
  made an unconditional human gate a spine property; with the specification gate skippable that has
  to be said in the pipeline vocabulary rather than assumed.
- An edge into a node that was skipped is **not offered**. The final gate reworks into `specify`
  today; under `none` that target never ran, and a rework edge into it would strand the task.
- Under `none` the kickoff brief carries an **acceptance list**: scenarios in the shape a
  specification's scenarios take, testable, checked mechanically by REQ-1303's completeness check
  before the brief reaches the gate. Under any other profile the brief is unchanged.
- Validation reads its scenario inventory from **the change's acceptance source** — the change's
  specs where a specification stage ran, the brief's acceptance list where it did not. An acceptance
  source declaring no scenarios fails the stage rather than corroborating an approve against nothing.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `spec-conventions`: REQ-1705 removed and replaced by a requirement that makes the specification
  stages conditional on the profile; REQ-1701 and REQ-1704 lose the sentences asserting that the
  pipeline always specifies.
- `pipeline-definitions`: REQ-409 admits a conditional gate and states that a predicate may read
  repository-scoped state; a new requirement governs edges targeting a skipped node.
- `task-lifecycle`: REQ-602's spine no longer includes specification, its review, or the
  specification gate.
- `kickoff-brief`: REQ-1302 and REQ-1303 gain the acceptance list the profile `none` requires.
- `verification`: REQ-1102 and REQ-1103 read the inventory from the change's acceptance source
  rather than from the change's specs, and reject an empty one.

## Non-goals

- **Detection is unchanged.** Which profile a repository resolves to, how the owner overrides it,
  and how it reaches a stage are REQ-1702 and REQ-1703 as they stand.
- **The `custom` profile keeps every stage.** A repository with a suite in another shape has
  somewhere for the specification to land, so nothing about it changes.
- **No new size or profile.** The reduction is decided by the repository's convention at the node,
  not by a fourth entry in the profile catalog.
- **The brief's ceiling is not revisited.** REQ-1302 keeps its configured length ceiling; whether
  an acceptance list crowds a one-page brief in practice is a tuning question for after this ships.
- **Archived tasks are not rewritten.** A task already past its specification gate keeps the graph
  it was pinned to.

## Impact

- `packages/core/src/pipeline.ts` — `NODE_FACT_KINDS` gains the repository's convention as an input
  fact, `NODE_PREDICATES` gains the predicate reading it, `NodeCondition` moves onto `GateNode`, and
  the three nodes in `FEATURE_BUGFIX_PIPELINE` gain conditions.
- `packages/core/test/pipeline.test.ts` — the three tests pinning REQ-1705 assert the reverse.
- The orchestrator's node dispatch — assembling the new fact, and suppressing gate edges whose
  target was skipped.
- `packages/runner/src/ledger.ts` — unchanged; the profile already reaches a stage as a ledger line.
- The validating stage's corroboration — the inventory's source becomes conditional.
- `apps/web/src/screens/task-screen.tsx` — the gate's rework targets are read straight off the
  pinned node today, so they need filtering by what the walk skipped; the rail itself already
  renders a skipped node with its reason and does not change.
- The gate command on the API side — a rework into a skipped target is refused there too, because a
  filtered list in the browser is not an enforcement point.
