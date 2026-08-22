## ADDED Requirements

### Requirement: REQ-1015 — Repository-scoped answers are readable and revocable over REST

The API SHALL expose the live repository-scoped answers for reading, each naming its repository,
which answer it is, the task whose resolution created it, and when. It SHALL accept an
authenticated revocation of one of them, after which it SHALL no longer be returned as live.
Revoking one that is already revoked or does not exist SHALL be reported as a structured error
naming what was not found, never as a silent success.

#### Scenario: AC-1043 — Reading what is in force

- **WHEN** the repository-scoped answers are read
- **THEN** the response SHALL carry every live one with its repository, its key, and the task it came from

#### Scenario: AC-1044 — Revoking one

- **WHEN** a live record is revoked
- **THEN** a subsequent read SHALL NOT return it, and a task afterward SHALL be asked rather than inherit it

#### Scenario: AC-1045 — Revoking what is not there

- **WHEN** a revocation names a record that does not exist or is already revoked
- **THEN** the API SHALL respond with a structured error naming it
