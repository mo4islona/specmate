## ADDED Requirements

### Requirement: REQ-1406 — An accepted gap is accepted for the repository, not just the task

Accepting a coverage gap SHALL record the acceptance against the task's repository, durably and
outside the task. A later task against that repository whose coverage is short of adequate SHALL
inherit the acceptance rather than raise the choice again: its coverage SHALL be waived, and the
inheritance SHALL be recorded as an already-resolved decision naming the task the acceptance came
from, so it is readable in the decision log every later stage receives and in the task's own view
without appearing as something the owner must act on. An inherited acceptance MUST NOT suppress a
choice the owner has not already made — a plan proposing prerequisite tasks SHALL still raise its
own.

An acceptance SHALL end when a probe classifies that repository's coverage as adequate, or when
the owner revokes it. It MUST NOT expire on elapsed time. A revoked acceptance SHALL stay readable
with the moment it ended.

#### Scenario: AC-1422 — The second task does not ask again

- **WHEN** a task's coverage is short of adequate and its repository carries an acceptance
- **THEN** its coverage SHALL be waived without raising the choice, and no open decision SHALL exist for it

#### Scenario: AC-1423 — The inheritance is visible

- **WHEN** a task inherits an acceptance
- **THEN** a resolved decision SHALL record it, naming the task the acceptance came from

#### Scenario: AC-1424 — Inheritance does not settle a different question

- **WHEN** a task inheriting an acceptance also carries a plan proposing prerequisite tasks
- **THEN** the choice about those tasks SHALL still be raised

#### Scenario: AC-1425 — The gap is closed

- **WHEN** a probe classifies a repository carrying an acceptance as adequate
- **THEN** the acceptance SHALL end, and the next task with a gap SHALL be asked again

#### Scenario: AC-1426 — The owner takes it back

- **WHEN** the owner revokes an acceptance
- **THEN** it SHALL stop applying to later tasks and SHALL remain readable as revoked

#### Scenario: AC-1427 — Accepting the same gap twice

- **WHEN** a second task's owner accepts a gap in a repository that already carries a live acceptance
- **THEN** exactly one live acceptance SHALL exist for that repository
