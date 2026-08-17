## MODIFIED Requirements

### Requirement: REQ-711 — An incomplete attempt's uncommitted changes can be discarded

A workspace SHALL support discarding everything uncommitted after a failed or owner-interrupted
attempt, restoring the working tree to the most recent stage commit on the task branch.
Discarding MUST remove files the attempt created as well as revert files it modified, MUST NOT
alter any commit already on the branch, and MUST leave runner scratch intact because the
attempt's log and result are execution evidence.

#### Scenario: AC-731 — Half-written artifacts from a failed attempt

- **WHEN** an attempt has modified tracked artifacts and created new ones, and the workspace is discarded
- **THEN** the working tree SHALL match the last stage commit and the created files SHALL be gone

#### Scenario: AC-732 — Committed work survives

- **WHEN** a workspace is discarded
- **THEN** every commit on the task branch SHALL still be present

#### Scenario: AC-733 — Runner scratch survives

- **WHEN** a workspace is discarded after an incomplete attempt that wrote a log or result
- **THEN** that execution evidence SHALL remain readable

#### Scenario: AC-734 — Nothing to discard

- **WHEN** a workspace is discarded while its working tree is already clean
- **THEN** the operation SHALL succeed and change nothing

#### Scenario: AC-735 — Interrupted edits are removed before restart

- **WHEN** an owner-interrupted attempt has been terminated and its workspace cleanup succeeds
- **THEN** its uncommitted edits SHALL be discarded before restart becomes available, and a later replacement SHALL see the last accepted commit
