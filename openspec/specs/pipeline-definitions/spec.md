# pipeline-definitions Specification

## Purpose
Defines pipelines as data: the declarative graph a task type follows — its stages, gates, loop
edges, and terminal — the catalog those definitions live in, the validation that makes a broken
definition impossible to load, and the pinning that makes a running task immune to catalog
changes. One generic engine interprets them all; adding a kind of work is a definition, not code.

## Requirements

### Requirement: REQ-401 — Pipelines are declarative definitions in a catalog keyed by task type

The system SHALL hold a catalog of pipeline definitions keyed by task type. A definition SHALL
declare its stage nodes (each binding one role), its human gate nodes (each naming its approve
target, any redirect target with the cap identity bounding it, and any rework targets), its loop
edges (each naming the loop identity whose cap bounds it), and its terminal outcome. Introducing
or reshaping a task type SHALL be a catalog change and MUST NOT require changes to the engine
that executes definitions.

#### Scenario: AC-401 — Task of a cataloged type is created

- **WHEN** a task is created with a type present in the catalog
- **THEN** its run graph SHALL be instantiated from that type's definition

#### Scenario: AC-402 — Task of an uncataloged type

- **WHEN** a task is created with a type the catalog does not contain
- **THEN** creation SHALL be rejected with a message naming the type

### Requirement: REQ-402 — Definitions are validated structurally before any task runs

Definitions SHALL be validated when loaded, before any task is scheduled: node keys MUST be
unique and MUST each be a legal task status value, every referenced role MUST exist in the role
catalog, every loop edge MUST point strictly backwards to an earlier node, every gate resolution
MUST name a node in the definition, and the terminal MUST be reachable from every node. A
definition violating any of these SHALL prevent startup with a message naming the definition and
the defect, so a broken pipeline is a failed deploy rather than a stuck task.

#### Scenario: AC-403 — Loop edge points forward

- **WHEN** a definition contains a loop edge targeting a later node
- **THEN** loading SHALL fail naming the definition and the offending edge

#### Scenario: AC-404 — Stage node names an unknown role

- **WHEN** a definition's stage node references a role absent from the role catalog
- **THEN** loading SHALL fail naming the node and the role

#### Scenario: AC-405 — Node key missing from the status set

- **WHEN** a definition's node key is not a legal task status value
- **THEN** startup SHALL fail naming the key and the migration-shaped gap

### Requirement: REQ-403 — A task pins its pipeline at creation

Creating a task SHALL instantiate its type's definition into the task's own run graph, and the
engine SHALL consult only that pinned copy thereafter. A later change to the catalog MUST NOT
alter the shape of a task already in flight. Re-planning a task SHALL append a new run graph
version rather than mutating the existing one, and prior versions with their stage history SHALL
be retained.

#### Scenario: AC-406 — Definition changes while a task is in flight

- **WHEN** the catalog's definition for a type changes after a task of that type was created
- **THEN** the task SHALL continue along the graph it was created with

#### Scenario: AC-407 — Re-planning appends a version

- **WHEN** a task is re-planned
- **THEN** a new run graph version SHALL be created and the prior version and its stages SHALL remain readable

### Requirement: REQ-404 — Instantiation stays inside the definition's declared bounds

An instantiated run graph SHALL contain exactly the nodes and edges of its definition.
Per-task variation SHALL be limited to caps, budgets, and provider bindings, and the varied
values SHALL be recorded on the task. A per-task variation MUST NOT add, remove, or rewire
nodes.

#### Scenario: AC-408 — Instance compared with its definition

- **WHEN** a task's pinned graph is compared with the catalog definition it came from
- **THEN** the nodes and edges SHALL be identical, and only caps, budgets, and provider bindings MAY differ

### Requirement: REQ-405 — The feature/bugfix definition realizes the task lifecycle

The catalog SHALL contain a definition serving both feature and bugfix tasks whose shape realizes
the task-lifecycle requirements: one planning node that grounds the brief, one specification node
that resumes it after the kickoff gate, a specification-review loop bounded by the spec cap
identity, an implementation segment whose single validating node loops back to implementation
under the impl cap identity, the human gates the lifecycle names, and summarisation before the
final gate.

Verification and code review SHALL be one node, not two. A definition MUST NOT contain a node that
executes a harness and a separate node that judges the same diff: they read the same input, loop to
the same target, and share one cap, and splitting them across two stages costs a second reading of
the diff while placing the cross-provider independence on the node that only asserts.

#### Scenario: AC-409 — Loop identities and targets

- **WHEN** the shipped feature/bugfix definition is inspected
- **THEN** its specification-review loop edge SHALL target the specification node under the spec cap, and its validation loop edge SHALL target implementation under the impl cap

#### Scenario: AC-410 — Gate inventory of the definition

- **WHEN** the shipped feature/bugfix definition's gate nodes are inspected
- **THEN** they SHALL be exactly the mandatory human gates the task lifecycle names

#### Scenario: AC-420 — One node checks an implementation

- **WHEN** the shipped feature/bugfix definition's nodes between implementation and summarisation are inspected
- **THEN** exactly one SHALL carry a loop edge to implementation, and it SHALL be the node that both executes the harness and returns the verdict

### Requirement: REQ-407 — A profile is a validated reduction of a base definition

The catalog SHALL be able to hold, alongside a task type's base definition, one or more reduced
profiles of it. A profile SHALL contain a subsequence of its base definition's nodes in their
original order, with the same terminal, and no node it keeps may reference a node it drops —
neither a gate's approve, redirect, or rework target, nor a loop edge's target, nor a node named by
another node's resumption. Both properties SHALL be checked when the catalog loads, and a profile
violating either SHALL prevent startup naming the profile and the defect, exactly as a defective
definition does. A profile MUST NOT add a node, reorder nodes, or rewire an edge its base does not
have.

#### Scenario: AC-414 — Profile keeps a node whose target it dropped

- **WHEN** a profile drops a node that a node it keeps still targets
- **THEN** loading SHALL fail naming the profile and the dangling target

#### Scenario: AC-415 — Profile reorders its base's nodes

- **WHEN** a profile's node list is not a subsequence of its base definition's
- **THEN** loading SHALL fail naming the profile

#### Scenario: AC-416 — A valid profile loads

- **WHEN** a profile drops only nodes nothing surviving references
- **THEN** it SHALL load, and every rule applying to a definition SHALL apply to it

#### Scenario: AC-426 — Profile drops the node another node resumes

- **WHEN** a profile keeps a node declaring resumption of a node the profile drops
- **THEN** loading SHALL fail naming the profile and the dangling resumption

### Requirement: REQ-408 — The declared size selects the profile and the caps a task runs

A task SHALL run the profile its declared size selects, and SHALL run under the iteration caps that
size selects. Each declarable size SHALL select a distinct combination: two sizes MUST NOT produce
the same profile under the same caps, because a size that changes nothing tells the owner it
changed something.

Because the size is not known until planning has read the repository, a task whose declared size
selects a profile other than the one its current graph names SHALL have that profile instantiated
as a new run graph version at the moment the declaration is recorded, and SHALL continue from the
node the new version puts next after the stage that declared it. Caps the declaration selects SHALL
be recorded on the task at the same moment and SHALL bound every loop from then on. The task's
completed stages and their prior graph version SHALL remain readable. A declaration selecting the
profile already running SHALL NOT append a version.

#### Scenario: AC-417 — A size that reduces the walk

- **WHEN** planning declares a size whose profile drops the nodes between it and the kickoff gate
- **THEN** a new run graph version SHALL be appended from that profile and the task SHALL move to the gate rather than to the dropped node

#### Scenario: AC-418 — A size that changes nothing

- **WHEN** planning declares a size selecting the profile the task is already running
- **THEN** no new run graph version SHALL be appended and the task SHALL advance along the graph it has

#### Scenario: AC-419 — The reduced task's history survives

- **WHEN** a task has swapped to a reduced profile
- **THEN** the stages it completed under the previous version SHALL remain readable together with that version

#### Scenario: AC-427 — Caps follow the declaration

- **WHEN** planning declares a size whose caps differ from the ones the task was created with
- **THEN** the declared size's caps SHALL be recorded on the task and SHALL bound every subsequent loop

#### Scenario: AC-428 — No two sizes are the same task

- **WHEN** the shipped catalog's declarable sizes are compared pairwise
- **THEN** no two SHALL select the same profile under the same caps

### Requirement: REQ-409 — A node may be conditional on a fact about its own input

A definition MAY declare a node conditional on a predicate evaluated when the task reaches it. A
conditional node whose predicate holds SHALL run as any other node does. A conditional node whose
predicate does not hold SHALL be skipped: the task SHALL advance to the node's forward target
without dispatching it, and the skip SHALL be recorded with the reason the predicate gives.

A skipped node SHALL remain a node of the task's graph. It MUST NOT be removed from the pinned
graph, and every surface that renders the graph SHALL show it as skipped together with its reason,
in the place a node that ran states its duration. A node dropped from the graph hides the decision
that dropped it; a node skipped with a stated reason shows it.

A predicate SHALL read only facts about the node's own input — the artifacts and the state present
when the task reaches it. A predicate MUST NOT read the verdict, the findings, or any other output
of the node it would skip, nor of a node that exists to check that node's output. A node skipping
itself on the strength of a judgement it exists to produce would be deciding its own necessity from
its own conclusion.

#### Scenario: AC-421 — A predicate that does not hold skips its node

- **WHEN** a task reaches a conditional node whose predicate does not hold
- **THEN** the node SHALL be skipped without dispatch, the task SHALL advance to its forward target, and the skip SHALL be recorded with the predicate's reason

#### Scenario: AC-422 — A skipped node is still shown

- **WHEN** a task's graph is rendered after a conditional node was skipped
- **THEN** the node SHALL appear in the graph marked skipped, carrying the reason where a node that ran carries its duration

#### Scenario: AC-423 — A predicate reading the output it would suppress

- **WHEN** a definition declares a predicate reading an output of the node it guards, or of a node whose purpose is to check that node
- **THEN** loading SHALL fail naming the node and the circular reading

### Requirement: REQ-410 — A node may declare that it resumes an earlier node's session

A stage node MAY declare that it continues the provider session an earlier node of the same
definition started, rather than beginning a new one. The declaration SHALL name a node that appears
strictly earlier in walking order and carries the same role; a declaration naming a later node, a
node the definition does not contain, or a node of a different role SHALL prevent startup naming
the node and the defect.

A resumption SHALL be a declaration about where the stage's context comes from, never a claim that
a process stayed running. The task MAY sit at a human gate between the two nodes for any length of
time, and the resumption SHALL remain valid across an orchestrator restart.

#### Scenario: AC-424 — Resumption pointing forward

- **WHEN** a node declares resumption of a node at or after its own position
- **THEN** loading SHALL fail naming the node and the direction

#### Scenario: AC-425 — Resumption across a gate

- **WHEN** a node resumes an earlier node's session and a human gate separates them
- **THEN** the resumption SHALL be valid however long the gate is held, and SHALL survive a restart between the two nodes
