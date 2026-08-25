## Context

See proposal.md — Why. What shapes the approach is the machinery already in place.

`2026-08-24-pipeline-compression` shipped conditional nodes: `NODE_FACT_KINDS` declares the facts a
predicate may read, `NODE_PREDICATES` declares what each predicate reads and how it judges,
`NodeCondition` attaches one to a node with a numeric threshold, and `validateDefinition` refuses at
module import a predicate that reads the output of the node it guards. One predicate exists,
`spec_scenarios_at_least`, and it reads one fact, `specScenarioCount`.

`2026-08-24-spec-convention-profiles` shipped the profile: provisioning resolves it from the
checked-out tree, `tasks.spec_convention` persists it, and the runner's ledger renders it as a line
next to `Harness coverage`. That change also pinned three tests asserting no predicate may read it —
those tests assert the reverse after this change.

Two constraints follow. The condition machinery takes a numeric fact and a numeric threshold, and
the profile is an enum. And conditions live on `StageNode` only, while one of the three nodes to
skip is a gate.

## Goals / Non-Goals

**Goals:**

- The three nodes carry conditions in the catalog, so what skips them is readable where the
  pipeline is declared rather than assembled in the engine.
- The convention is read when the task reaches each node, so an owner's answer mid-task governs.
- One inventory parser serves both acceptance sources.

**Non-Goals:**

- Generalising conditions to non-boolean repository state. One fact, one predicate; a second
  repository-scoped condition can widen the model when there is a second one.
- A settings surface for the acceptance list. It is written by the planner and read at the gate,
  where the brief already is.
- Reworking how the profile is detected or overridden. That is REQ-1702 and REQ-1703, untouched.

## Decisions

### D1 — The skip is a condition on the node, not a fourth profile

A profile that drops the three nodes would be the smaller diff: `COMPACT_DROPS` already exists and
`validateReduction` already checks that nothing strands. It is the wrong shape twice over.

A profile is selected by the size the planner declares (`PROFILE_FOR_SIZE`), and the size is
declared during planning — before provisioning has necessarily settled the convention, and long
before the owner might set it. Making the convention select a profile crosses two axes that pick
graphs independently, and the catalog would need a profile per (size × convention) pair.

The second reason is the one REQ-409 already argues: a dropped node hides the decision that dropped
it. AC-1717 requires the three to be visible as skipped, which only a condition delivers.

### D2 — `threshold` becomes optional; a predicate declares whether it takes one

`NodeFacts` is `Record<InputFactKey, number>` and `NodeCondition.threshold` is a required number,
because the only predicate compares a count against a floor. The convention is not a count.

Encoding it as `0`/`1` and comparing against a threshold of `1` was rejected: the catalog entry
would read `spec_suite_at_least: 1`, which is a lie about what is being tested, and the reason
string a predicate must produce ("the repository has no specification suite") has nothing to do with
the number.

So the fact model widens by one step: an input fact may be a number or a boolean, `threshold` on
`NodeCondition` becomes optional, and `PredicateSpec` declares whether it takes one.
`validateDefinition` gains the matching check — a condition supplying a threshold to a predicate
that takes none, or omitting one where it is needed, fails at import the way every other definition
defect does.

The alternative was a second condition shape (`NodeCondition | NodeFlagCondition`). One optional
field beats a union the engine has to narrow at every read.

### D3 — The fact is `specSuiteInForce`, assembled from the task row

`tasks.spec_convention` is written by provisioning and already resolves REQ-1701's edge case: a
configured suite location absent from the tree is persisted as none. So the fact is one boolean off
that row, with no new column and no change to the ledger line that already reads it.

Reading it at dispatch is not enough for AC-1719, though. The owner's setting is repository-scoped
and reaches the task row only when provisioning re-resolves it, so a row taken straight from the
tick's snapshot still holds yesterday's answer. The engine therefore provisions first and re-reads
the row, for a gate as well as for a stage. Provisioning runs before every stage in any case and is
idempotent, so the cost at a gate is one no-op re-resolve — cheaper than the alternative, which was
to key the behaviour on node kind and rely on the stage before the gate having refreshed the row.

A fact the engine could not assemble is left out of the bundle rather than guessed, and
`evaluateCondition` runs the node. This is also why the convention is read as a boolean rather than
as the profile: an unresolved convention is *absent*, which is not the same as `none`, and a task
whose first node were conditional would otherwise skip on the strength of a value nobody had
computed yet.

Naming it for the suite rather than for the profile keeps the predicate honest about what it tests:
`custom` and `openspec` differ in convention, and the three nodes do not care which.

### D4 — A skipped gate advances along its approve edge

A stage's forward target is the next node; a gate's is a choice. The approve edge is the one a gate
takes when nothing is wrong, and it is what the reachability walk already pushes for a gate, so a
skipped gate needs no new edge kind. The gate is not presented, no decision is recorded as though
the owner made one, and the skip is recorded with its reason like any other.

Rejected: treating a skipped gate as an automatic approve. An approve is an owner's act with an
audit trail (REQ-1201 and the decisions capability); manufacturing one from a repository fact would
put a signature on a decision nobody made.

### D5 — Edge suppression reads the walk, and is enforced on the server

`task-screen.tsx:353` reads the gate's rework targets straight off the pinned node, so today the
final gate under the profile none would offer "rework: specify" for a stage that never ran.

The filter is the same predicate in both places: a target whose node was skipped on this walk. The
walk is already in the run record — the rail renders skipped nodes from it — so no new state is
needed. The browser filters so the edge is not shown; the gate command refuses so the edge is not
takeable. A list filtered only in the browser is a suggestion, and this one has to be a rule.

### D6 — The acceptance list is scenarios in the shape the suite already uses

The brief's acceptance list uses `#### Scenario:` headings with WHEN/THEN bullets under a fixed
heading in the brief — the shape a specification's scenarios take. The validator's inventory parser
then reads one shape from two files, and REQ-1303's completeness check counts headings the way it
counts the brief's other parts.

Rejected: a YAML or JSON block. It parses more cleanly and reads worse, and the brief is a page a
human opens at a gate. Two parsers for one concept is the cost the spec standard exists to avoid.

### D7 — A node may carry more than one condition, and the first failure gives the reason

Found while writing the catalog. `spec_review` already carries the scenario floor from
`2026-08-24-pipeline-compression`, and it needs the suite condition too. With only the floor, a task
under the profile none skips the review saying "the specification declares 0 scenario(s), under the
4 this node is worth" — true, and silent about why there are none. AC-1717 asks each skipped node
for the reason it was skipped, and that is not it.

So `condition` accepts one condition or several, evaluated in order, and the first that does not
hold gives the reason. Both floors stay in force.

The single form stays legal rather than being migrated to an array of one, because run graphs are
pinned in the database with their nodes: renaming or reshaping the field would leave every in-flight
task's condition unreadable, and an unreadable condition is a node that runs unguarded.

Rejected: a second field for the plural form. Two spellings of one concept, and every reader would
have to know both.

## Risks / Trade-offs

- **Acceptance is fixed before research.** The brief is written by the planner before it has read
  the code as thoroughly as a specifying stage would → the final gate still reviews the work, and a
  revise verdict at validation still loops on implementation. What is lost is the chance to revise
  the acceptance itself at a gate; that is the cost the owner accepted in taking the segment out.
- **One human gate fewer before implementation under `none`.** → The kickoff gate now approves the
  acceptance list, which is the thing the specification gate approved. The number of gates drops;
  what the owner signs does not.
- **The profile can change between the kickoff gate and the specifying stage.** A task can be
  planned as though it would specify and then skip (or the reverse) → the skip carries its reason
  and is on the graph, so the record explains itself. AC-1719 makes the behaviour the specified one
  rather than an accident.
- **An empty acceptance list would make approve vacuous.** This is the failure REQ-1705 named and
  the reason it existed → two independent checks: REQ-1303 refuses to commit a brief without a
  scenario, and REQ-1103 fails the validating stage on an empty inventory even if one got through.
- **The three pinned tests invert.** A future reader finds tests asserting the opposite of what the
  archived `2026-08-24-spec-convention-profiles` argued → the REMOVED block in the delta carries the
  reason, and the archived change stays readable beside it.

## Migration Plan

No backfill. A run graph is pinned with its nodes and their conditions, so a task pinned before
deploy carries nodes with no condition and keeps running the segment to completion. The change takes
effect for graphs pinned after it ships.

Rollback is the same shape: the conditions are catalog data, and removing them restores today's
behaviour for graphs pinned afterwards. Tasks that skipped the segment under the new catalog keep a
graph whose skips are recorded; they do not need the stages back to reach publication, because their
acceptance is in the brief the validator already read.
