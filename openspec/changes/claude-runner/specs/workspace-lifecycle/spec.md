## ADDED Requirements

### Requirement: A failed attempt's uncommitted changes can be discarded

A workspace SHALL support discarding everything uncommitted, restoring the working tree to the
most recent stage commit on the task branch. Discarding MUST remove files an attempt created as
well as revert files it modified, MUST NOT alter any commit already on the branch, and MUST leave
the runner scratch intact, because the failed attempt's log and result are the evidence a human
is shown.

#### Scenario: Half-written artifacts from a failed attempt

- **WHEN** an attempt has modified tracked artifacts and created new ones, and the workspace is discarded
- **THEN** the working tree SHALL match the last stage commit and the created files SHALL be gone

#### Scenario: Committed work survives

- **WHEN** a workspace is discarded
- **THEN** every commit on the task branch SHALL still be present

#### Scenario: Runner scratch survives

- **WHEN** a workspace is discarded after a failed attempt that wrote a log and a result
- **THEN** both SHALL still be readable

#### Scenario: Nothing to discard

- **WHEN** a workspace is discarded while its working tree is already clean
- **THEN** the operation SHALL succeed and change nothing
