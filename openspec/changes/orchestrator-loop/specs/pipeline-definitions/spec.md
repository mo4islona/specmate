## Purpose

Defines pipelines as data: the declarative graph a task type follows — its stages, gates, loop
edges, and terminal — the catalog those definitions live in, the validation that makes a broken
definition impossible to load, and the pinning that makes a running task immune to catalog
changes. One generic engine interprets them all; adding a kind of work is a definition, not code.

## ADDED Requirements

### Requirement: Pipelines are declarative definitions in a catalog keyed by task type

The system SHALL hold a catalog of pipeline definitions keyed by task type. A definition SHALL
declare its stage nodes (each binding one role), its human gate nodes (each naming its approve
target, any redirect target with the cap identity bounding it, and any rework targets), its loop
edges (each naming the loop identity whose cap bounds it), and its terminal outcome. Introducing
or reshaping a task type SHALL be a catalog change and MUST NOT require changes to the engine
that executes definitions.

#### Scenario: Task of a cataloged type is created

- **WHEN** a task is created with a type present in the catalog
- **THEN** its run graph SHALL be instantiated from that type's definition

#### Scenario: Task of an uncataloged type

- **WHEN** a task is created with a type the catalog does not contain
- **THEN** creation SHALL be rejected with a message naming the type

### Requirement: Definitions are validated structurally before any task runs

Definitions SHALL be validated when loaded, before any task is scheduled: node keys MUST be
unique and MUST each be a legal task status value, every referenced role MUST exist in the role
catalog, every loop edge MUST point strictly backwards to an earlier node, every gate resolution
MUST name a node in the definition, and the terminal MUST be reachable from every node. A
definition violating any of these SHALL prevent startup with a message naming the definition and
the defect, so a broken pipeline is a failed deploy rather than a stuck task.

#### Scenario: Loop edge points forward

- **WHEN** a definition contains a loop edge targeting a later node
- **THEN** loading SHALL fail naming the definition and the offending edge

#### Scenario: Stage node names an unknown role

- **WHEN** a definition's stage node references a role absent from the role catalog
- **THEN** loading SHALL fail naming the node and the role

#### Scenario: Node key missing from the status set

- **WHEN** a definition's node key is not a legal task status value
- **THEN** startup SHALL fail naming the key and the migration-shaped gap

### Requirement: A task pins its pipeline at creation

Creating a task SHALL instantiate its type's definition into the task's own run graph, and the
engine SHALL consult only that pinned copy thereafter. A later change to the catalog MUST NOT
alter the shape of a task already in flight. Re-planning a task SHALL append a new run graph
version rather than mutating the existing one, and prior versions with their stage history SHALL
be retained.

#### Scenario: Definition changes while a task is in flight

- **WHEN** the catalog's definition for a type changes after a task of that type was created
- **THEN** the task SHALL continue along the graph it was created with

#### Scenario: Re-planning appends a version

- **WHEN** a task is re-planned
- **THEN** a new run graph version SHALL be created and the prior version and its stages SHALL remain readable

### Requirement: Instantiation stays inside the definition's declared bounds

An instantiated run graph SHALL contain exactly the nodes and edges of its definition.
Per-task variation SHALL be limited to caps, budgets, and provider bindings, and the varied
values SHALL be recorded on the task. A per-task variation MUST NOT add, remove, or rewire
nodes.

#### Scenario: Instance compared with its definition

- **WHEN** a task's pinned graph is compared with the catalog definition it came from
- **THEN** the nodes and edges SHALL be identical, and only caps, budgets, and provider bindings MAY differ

### Requirement: The feature/bugfix definition realizes the task lifecycle

The catalog SHALL contain a definition serving both feature and bugfix tasks whose shape
realizes the task-lifecycle requirements: a research⇄spec-review loop bounded by the spec cap
identity, an implementation segment whose loop edges from verification and code review both
target implementation and share the impl cap identity, the human gates the lifecycle names, and
summarisation before the final gate.

#### Scenario: Loop identities and targets

- **WHEN** the shipped feature/bugfix definition is inspected
- **THEN** its spec-review loop edge SHALL target research under the spec cap, and its verification and code-review loop edges SHALL target implementation under the shared impl cap

#### Scenario: Gate inventory of the definition

- **WHEN** the shipped feature/bugfix definition's gate nodes are inspected
- **THEN** they SHALL be exactly the mandatory human gates the task lifecycle names
