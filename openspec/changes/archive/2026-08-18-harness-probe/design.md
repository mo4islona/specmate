## Context

See proposal.md — Why. What exists, and the seams this change has to fit:

- `harness_status` is a database enum with exactly the vocabulary
  `unknown | adequate | partial | missing | waived`, defaulting to `unknown`. Nothing writes
  it; `renderLedger` already prints it to every stage as "Harness coverage".
- `blocked_by uuid[]` exists and is never written. `blocked` is a `TaskState`, is in
  `RESERVED_STATES` (so no pipeline node may claim it) and in the engine's `NOT_RUNNABLE` poll
  exclusion — a blocked task is already never dispatched. `graphTransitions` gives it
  `[graph.entry, 'cancelled']`, so leaving it is already legal; `canTransition`'s
  `entersInterrupt` covers only `waiting_human`, `paused`, and `cancelled`, so **entering** it
  is not.
- `kickoff-brief` (in flight) puts the ⚠ key-points block in the brief and runs `checkBrief` in
  the executor after the run, before the commit, declared by the role catalog. It also gives
  tasks a `description` — the owner's request in their own words — which is where a spawned
  harness task's brief comes from.
- `decision-records` (in flight) gives decisions their options, the non-blocking kind that
  reaches a gate rather than parking short of it, and the rule that approving a gate resolves
  what the task left open (answers stand, the rest are dismissed).
- `verifier-stage` (in flight) establishes the pattern this change's `agent-contracts` delta
  copies: a role-catalog flag declaring that a role's result must carry a structured field, and
  invalid-result handling when it does not.
- `createTask` in the orchestrator store instantiates the pinned graph at creation; the API's
  intake calls it. Nothing else creates tasks.

## Goals / Non-Goals

**Goals:**

- The classification is data from the first moment, so nothing downstream ever parses prose to
  find out whether the work can be proven.
- The gap is impossible to omit: the brief check refuses the silent brief, so "no warning" can
  only mean "no gap".
- `blocked` becomes real by being specified generically. Phase 4's cross-repo task chains get
  the same mechanism without a second implementation.

**Non-Goals:**

- Any new state, table, or column. Every field this change needs was provisioned in Phase 0 and
  has been sitting unused; if this design needs a migration, it has gone wrong somewhere.
- Automating the judgement. The probe classifies and the owner decides; there is no threshold at
  which the system splits a task by itself.

## Decisions

### IDs stay within capability bands

Per the `openspec-standard` skill: the new `harness-coverage` capability claims band 1400
(REQ-1401–REQ-1405, AC-1401–AC-1416) in `openspec/id-bands.yaml`. The added requirements in
existing capabilities take the next free numbers in their own bands — REQ-110 with
AC-123–AC-125 in agent-contracts, REQ-615 with AC-626–AC-629 in task-lifecycle. Both are ADDED
rather than MODIFIED: neither restates an existing requirement, and ADDing keeps this change
from colliding with the in-flight changes that modify their neighbours.

### The classification rides the result, not the brief

`StageResult` gains an optional coverage assessment — the classification plus the evidence
behind it — and the role catalog gains `probesHarness`, set for the planner. Result validation
rejects a probing result without one, which routes it into the existing retry-then-escalate
flow. This is `verifier-stage`'s `returnsVerdict` shape reused deliberately: two roles now owe
the engine a structured field beyond `status`, and they owe it the same way.

The alternative — writing the classification into the brief and parsing it back — was rejected
for the reason `verifier-stage` rejected the same idea for verdicts: it puts a prose parser on
the critical path of a decision, and makes the document do two jobs. The brief still *states*
the classification, because the human reads the brief; the store's copy is what the system acts
on.

Which planner node probes: `planning`, the node that reads the repository (`kickoff-brief`'s
split). `kickoff_brief` does not re-read the repository, so it cannot classify — it restates
what planning found. The role flag is therefore about the role's obligation, and a
`kickoff_brief` run inherits it: it repeats the classification it was given in its own result.
That keeps the contract role-level, as the runner needs, and costs the prompt one sentence.

### The gap warning is a conditional part of the existing check

`checkBrief` already refuses a brief missing a required part. It gains one conditional rule:
when the task's recorded coverage is short of adequate, the key-points block must carry a
coverage warning. The check needs the task's coverage as an input, which the executor has —
this is the same shape as the length ceiling, a parameter rather than a hardcoded constant.

Refusing the brief rather than injecting the warning automatically is the point. An injected
warning would be a sentence the planner never reasoned about, sitting in a document whose whole
purpose is that a human reads and trusts it; failing the attempt makes the planner rewrite the
brief with the gap actually accounted for in its approach.

### The choice is a decision with options, and approval is a vote

The three-way choice is exactly what `DecisionRequest.options` is for. It is raised
**non-blocking** for the same reason the brief's own questions are: parking the task before the
gate would ask the owner to choose without the brief in front of them.

That leaves one case to name: the owner approves the gate without answering. `decision-records`
dismisses whatever is unanswered — but silently dropping *this* one would leave the task walking
on with `partial` coverage and no record of anyone accepting it. So the coverage decision's
dismissal means proceeding, and the waiver is written at that moment. The requirement
(AC-1409) states it explicitly rather than leaving it as an implementation detail, because it is
the one place where "the owner did nothing" has a consequence.

Recording the acceptance as `harness_status = 'waived'` rather than inferring it from decision
history is what makes REQ-1405 cheap: the ledger already prints the coverage line, so every
later stage learns about the waiver with no new plumbing, and the summarizer's prompt gains one
sentence.

### A split re-plans the blocked task rather than resuming it

When the harness task lands, the original could resume where it stopped — at its kickoff gate,
with a brief written against a repository that no longer looks like that, and a classification
that is now wrong. So release goes to the pipeline's entry, which `graphTransitions` already
declares as `blocked`'s only forward edge. The task re-plans, re-probes, and produces a brief
against the harness that now exists. That is a few cheap planner runs to avoid the worst
failure mode available here: proceeding under a stale `missing` classification after someone
went and fixed it.

`blocked` needs one engine change to be enterable: `entersInterrupt` in `canTransition` widens
to include it. Everything else — the poll exclusion, the reserved-status guard, the outgoing
edges — is already in place, which is the sign that Phase 0 provisioned this state on purpose.

### Release is driven by the blocker's terminal transition

No scheduler and no polling of blocked tasks: `releaseIfTerminal` already runs on every task
reaching its terminal, and it is where the check for dependents goes. A blocker that archives
releases its dependents (last one out releases the task); a blocker that is cancelled or fails
raises each dependent to the human with a decision explaining which blocker died — which is
strictly better than releasing it into a pipeline whose premise just evaporated.

## Risks / Trade-offs

- **The probe can be wrong in both directions.** An optimistic `adequate` suppresses the warning
  and the choice; a pessimistic `missing` costs the owner a decision they did not need. The
  asymmetry is handled by requiring evidence in the classification (AC-1402), so the owner can
  see what it rested on and overrule it by proceeding — but there is no mechanism forcing the
  probe to be honest, unlike the verifier's mechanical corroboration. Accepted: the probe judges
  what *exists*, which the reviewer and the owner can both check cheaply, while the verifier
  judges what *happened*, which they cannot.
- **A split can strand a task for a long time.** The harness task is a full pipeline run with
  its own gates; the blocked task waits through all of it. Mitigated by the release path and by
  the dead-blocker escalation, not by any timeout — a stalled harness task shows up in the
  attention inbox on its own account.
- **Re-planning on release throws away the blocked task's brief.** Deliberate, and cheap: the
  planner is the least expensive stage. The owner's original request survives on the task, so
  nothing they wrote is lost.
- **`waived` is sticky.** Only a later classification of the same task supersedes it, which
  means a task waived once and then re-planned against a repaired repository is reclassified —
  but a task waived and never re-planned carries the waiver to the end even if someone lands a
  harness meanwhile. That is the honest reading: the work was not verified against it.

## Migration Plan

No migration. `harness_status`, `blocked_by`, and the `blocked` status all exist and are unused;
`StageResult` and the role catalog widen in TypeScript only. Tasks created before this change
read as `unknown`, which no longer occurs after planning but is the correct historical value for
tasks that never probed.

Ordering: after `kickoff-brief`, which owns the brief's key-points block and the check REQ-1402
extends, and therefore after `decision-records`, whose non-blocking decisions and dismissal
semantics REQ-1403 rides, and transitively after `task-qa`, whose discussion makes that choice
clarifiable before confirmation. Against the other in-flight changes there is no contention: this
change ADDs REQ-110 to agent-contracts (`task-qa` modifies REQ-102, `verifier-stage` REQ-104)
and ADDs REQ-615 to task-lifecycle while `task-qa` MODIFIES REQ-613.
