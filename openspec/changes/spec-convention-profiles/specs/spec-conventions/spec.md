## Purpose

How SpecMate learns which specification convention a target repository follows, how that reaches a
running stage, and what a role does with it — so a change is written against the specification a
repository already has rather than beside it.

## ADDED Requirements

### Requirement: REQ-1701 — A repository has exactly one spec convention profile

Every task SHALL run under exactly one spec convention profile for its repository, drawn from a
fixed set: an OpenSpec suite, a suite in another shape at a configured location, or none. The
profile SHALL describe where the repository's living specification is and which convention governs
it. It SHALL NOT describe whether the pipeline specifies, which it always does.

A profile naming a configured location SHALL be in force only while that location is configured
and present in the checked-out tree. Where it is not, the task SHALL run as though the repository
had no specification, and the discrepancy SHALL be visible to the owner rather than silent.

#### Scenario: AC-1701 — One profile in force

- **WHEN** a stage is dispatched for a task
- **THEN** exactly one profile SHALL be in force for it, and it SHALL be one of the fixed set

#### Scenario: AC-1702 — A configured location that is not there

- **WHEN** a task runs under a profile whose configured suite location is absent from the checked-out tree
- **THEN** the task SHALL proceed as though the repository had no specification, and the owner SHALL be told the configured location was not found

### Requirement: REQ-1702 — The profile is detected, and the owner's answer wins

Provisioning SHALL determine the profile from the checked-out tree: a repository with an OpenSpec
root resolves to the OpenSpec profile, and a repository with nothing recognisable resolves to none.
A suite in another shape SHALL NOT be detected — it exists only where the owner configured it.

The owner MAY set the profile for a repository, and that setting SHALL override detection for
every task in that repository until it is changed or removed. The setting is scoped to the
repository, not to the task that made it, and a later task SHALL inherit it without being asked
again — the same scoping an accepted coverage gap has under REQ-1406.

#### Scenario: AC-1703 — Detected as an OpenSpec repository

- **WHEN** a workspace is provisioned for a repository that has an OpenSpec root
- **THEN** the OpenSpec profile SHALL be in force for the task

#### Scenario: AC-1704 — Nothing recognisable

- **WHEN** a workspace is provisioned for a repository with no OpenSpec root and no configured suite
- **THEN** the profile SHALL be none

#### Scenario: AC-1705 — The owner overrides detection

- **WHEN** the owner has set a profile for a repository whose tree would detect a different one
- **THEN** the owner's profile SHALL be in force

#### Scenario: AC-1706 — The setting outlives the task

- **WHEN** a second task is launched against a repository whose profile the owner set during an earlier task
- **THEN** it SHALL run under that profile without asking again

### Requirement: REQ-1703 — The profile reaches a stage as task state, never as specification text

A stage's ledger SHALL carry the profile in force, naming where the repository's specification
suite is and which convention governs it, and SHALL state plainly when there is none rather than
omitting the fact. No content read out of the suite SHALL be copied into the prompt: a role that
needs the specification reads it from the working tree with the tools it already reads code with.
The sources a stage's prompt is assembled from are unchanged (REQ-102).

#### Scenario: AC-1707 — A suite exists

- **WHEN** a stage is prepared for a task whose repository has a specification suite
- **THEN** its ledger SHALL name that suite's location and convention

#### Scenario: AC-1708 — No suite exists

- **WHEN** a stage is prepared for a task whose repository has no specification suite
- **THEN** its ledger SHALL say so explicitly

#### Scenario: AC-1709 — The suite is not pasted into the prompt

- **WHEN** a stage is prepared for a task whose repository has a specification suite
- **THEN** the prompt SHALL contain no text copied from that suite

### Requirement: REQ-1704 — The planner grounds the change in the specification that already exists

Where a specification suite is in force, the planning role SHALL read it and ground the change in
it. The brief SHALL name the existing requirements the request touches by their identifiers, and
the change's own specification SHALL be written as a delta against those identifiers — modifying,
extending or adding to what governs the area — rather than restating governed behaviour as new
prose. Where the suite carries an identifier allocation convention, a newly introduced identifier
SHALL follow it.

Where no suite is in force, the planning role SHALL write the change's specification free-standing
and SHALL NOT invent identifiers as though a suite existed.

#### Scenario: AC-1710 — The brief names what governs the area

- **WHEN** a brief is written for a request that touches behaviour the repository's suite already specifies
- **THEN** it SHALL name those requirements by their identifiers

#### Scenario: AC-1711 — The specification is written as a delta

- **WHEN** the specifying stage runs for a task whose repository has a specification suite covering the area it changes
- **THEN** the change's specification SHALL be expressed as changes to the identified requirements rather than as a parallel description of the same behaviour

#### Scenario: AC-1712 — Nothing to ground in

- **WHEN** the specifying stage runs under the profile none
- **THEN** the change's specification SHALL stand on its own and SHALL cite no identifier from a suite

#### Scenario: AC-1713 — A suite in another shape

- **WHEN** a task runs under a configured suite whose convention the owner described
- **THEN** the planning role SHALL ground the change in that suite under the described convention

### Requirement: REQ-1705 — A repository with no specification still runs the specifying stage

No profile SHALL remove, skip or make conditional any stage of the spine REQ-602 protects. The
absence of a specification suite in a repository is the profile none, and a task under it SHALL
walk the same pipeline, run the same specifying stage, and present the same specification at the
gate as a task in a repository with a suite. A repository having no specification is a fact about
the repository, never a reduction of the process.

#### Scenario: AC-1714 — The pipeline is the same under every profile

- **WHEN** the pipeline of a task running under any profile is inspected
- **THEN** it SHALL contain the specifying stage and every other stage of the spine

#### Scenario: AC-1715 — A task in a repository with no specification

- **WHEN** a task runs to the specification gate in a repository with no specification suite
- **THEN** the gate SHALL present a specification produced by the specifying stage
