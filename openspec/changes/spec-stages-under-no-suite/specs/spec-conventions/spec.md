## MODIFIED Requirements

### Requirement: REQ-1701 — A repository has exactly one spec convention profile

Every task SHALL run under exactly one spec convention profile for its repository, drawn from a
fixed set: an OpenSpec suite, a suite in another shape at a configured location, or none. The
profile SHALL describe where the repository's living specification is and which convention governs
it, and — per REQ-1706 — whether the pipeline's specification segment runs at all.

A profile naming a configured location SHALL be in force only while that location is configured
and present in the checked-out tree. Where it is not, the task SHALL run as though the repository
had no specification, and the discrepancy SHALL be visible to the owner rather than silent.

#### Scenario: AC-1701 — One profile in force

- **WHEN** a stage is dispatched for a task
- **THEN** exactly one profile SHALL be in force for it, and it SHALL be one of the fixed set

#### Scenario: AC-1702 — A configured location that is not there

- **WHEN** a task runs under a profile whose configured suite location is absent from the checked-out tree
- **THEN** the task SHALL proceed as though the repository had no specification, and the owner SHALL be told the configured location was not found

### Requirement: REQ-1704 — The planner grounds the change in the specification that already exists

Where a specification suite is in force, the planning role SHALL read it and ground the change in
it. The brief SHALL name the existing requirements the request touches by their identifiers, and
the change's own specification SHALL be written as a delta against those identifiers — modifying,
extending or adding to what governs the area — rather than restating governed behaviour as new
prose. Where the suite carries an identifier allocation convention, a newly introduced identifier
SHALL follow it.

Where no suite is in force there is no specifying stage to ground (REQ-1706), and what the change
must satisfy is stated in the brief instead (REQ-1302). Where a suite is in force but says nothing
about the area the change touches, the specification SHALL stand on its own and SHALL NOT cite an
identifier it did not allocate — grounding is in what governs the area, not in the nearest thing
the suite happens to contain.

#### Scenario: AC-1710 — The brief names what governs the area

- **WHEN** a brief is written for a request that touches behaviour the repository's suite already specifies
- **THEN** it SHALL name those requirements by their identifiers

#### Scenario: AC-1711 — The specification is written as a delta

- **WHEN** the specifying stage runs for a task whose repository has a specification suite covering the area it changes
- **THEN** the change's specification SHALL be expressed as changes to the identified requirements rather than as a parallel description of the same behaviour

#### Scenario: AC-1712 — Nothing to ground in

- **WHEN** the specifying stage runs for a task whose suite covers nothing the change touches
- **THEN** the change's specification SHALL stand on its own and SHALL cite no identifier it did not allocate

#### Scenario: AC-1713 — A suite in another shape

- **WHEN** a task runs under a configured suite whose convention the owner described
- **THEN** the planning role SHALL ground the change in that suite under the described convention

## ADDED Requirements

### Requirement: REQ-1706 — Without a suite, the specification segment is skipped

Where the profile in force is none, the specifying stage, its review, and the specification gate
SHALL be skipped: the task SHALL advance past each without dispatching it or asking the owner, and
each skip SHALL be recorded with the reason. Under any other profile all three SHALL run as they do
today.

They SHALL be skipped, never dropped. The three nodes SHALL remain nodes of the task's pinned graph
and SHALL be rendered as skipped carrying their reason, on the terms REQ-409 sets for any
conditional node. A repository with no suite is then visible as a decision the graph states, rather
than as a shorter graph nobody can account for.

The profile is read when the task reaches each node, not when its graph is pinned. An owner who
sets a repository's profile while a task is between its kickoff gate and its specifying stage SHALL
have that answer govern what the task does next.

Skipping the segment SHALL NOT weaken what the task must satisfy before publication. The acceptance
the specification would have carried is carried by the brief (REQ-1302) and corroborated at
validation (REQ-1103); an approve SHALL NOT become available on the strength of there being nothing
to check.

#### Scenario: AC-1716 — A repository with no suite

- **WHEN** a task under the profile none passes its kickoff gate
- **THEN** the specifying stage, its review and the specification gate SHALL be skipped, and the task SHALL reach implementation without an agent run or an owner decision between them

#### Scenario: AC-1717 — The skip is on the graph, not missing from it

- **WHEN** the graph of a task that skipped the specification segment is rendered
- **THEN** all three nodes SHALL appear marked skipped, each carrying the reason it was skipped

#### Scenario: AC-1718 — A repository with a suite

- **WHEN** a task runs under the OpenSpec profile or a configured suite in another shape
- **THEN** the specifying stage, its review and the specification gate SHALL run, subject only to the conditions they already carry

#### Scenario: AC-1719 — The owner answers mid-task

- **WHEN** the owner sets a repository's profile after a task passed its kickoff gate and before it reached the specifying stage
- **THEN** the task SHALL run or skip the segment according to the profile the owner set

#### Scenario: AC-1720 — Nothing to check is not an approve

- **WHEN** a task that skipped the specification segment reaches validation
- **THEN** the verdict SHALL be corroborated against the brief's acceptance, and an inventory declaring no scenarios SHALL fail the stage rather than corroborate an approve

## REMOVED Requirements

### Requirement: REQ-1705 — A repository with no specification still runs the specifying stage

**Reason**: The stage produced a specification that cited no identifier, governed nothing after the
task archived, and cost two agent runs and one human gate to reach that state. The requirement's
own argument — that removing the stage strands validation, because an approve is held to covering
every scenario the change's specification declares — is answered by REQ-1706 and the acceptance
list REQ-1302 now requires under the profile none, rather than by keeping the stages.

**Migration**: REQ-1706 governs what a task in a repository with no suite does. Its acceptance
comes from the brief (REQ-1302, REQ-1303) and is corroborated at validation (REQ-1102, REQ-1103).
Tasks pinned to a graph before this change keep that graph and are unaffected. AC-1712 keeps its
title and its ID under REQ-1704: "nothing to ground in" is now a suite that covers nothing the
change touches, since under the profile none no specifying stage runs to have the problem.
