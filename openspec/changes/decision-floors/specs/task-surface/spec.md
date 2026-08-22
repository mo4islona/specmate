## ADDED Requirements

### Requirement: REQ-1015 — Standing decisions are readable and revocable over REST

The API SHALL expose the decisions in force beyond their task for reading, each naming the
repository it applies to, which decision it is, the task whose resolution made it, and when. It
SHALL accept an authenticated revocation of one of them, after which it SHALL no longer be
returned as in force. Revoking one that is already revoked or does not exist SHALL be reported as
a structured error naming what was not found, never as a silent success.

#### Scenario: AC-1043 — Reading what is in force

- **WHEN** the decisions in force are read
- **THEN** the response SHALL carry every one of them with its repository, its key, and the task it came from

#### Scenario: AC-1044 — Revoking one

- **WHEN** a record in force is revoked
- **THEN** a subsequent read SHALL NOT return it, and a task afterward SHALL be asked rather than inherit it

#### Scenario: AC-1045 — Revoking what is not there

- **WHEN** a revocation names a record that does not exist or is already revoked
- **THEN** the API SHALL respond with a structured error naming it
