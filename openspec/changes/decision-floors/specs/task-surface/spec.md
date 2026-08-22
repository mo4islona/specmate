## ADDED Requirements

### Requirement: REQ-1015 — Coverage waivers are readable and revocable over REST

The API SHALL expose the repositories whose coverage gap the owner has accepted and not taken
back, each naming the repository, the task whose resolution accepted it, and when. It SHALL accept
an authenticated revocation of one of them, after which it SHALL no longer be returned as in
force. Revoking one that is already revoked or does not exist SHALL be reported as a structured
error naming what was not found, never as a silent success.

#### Scenario: AC-1043 — Reading what is in force

- **WHEN** the accepted coverage gaps are read
- **THEN** the response SHALL carry every one still in force with its repository and the task it came from

#### Scenario: AC-1044 — Revoking one

- **WHEN** an acceptance in force is revoked
- **THEN** a subsequent read SHALL NOT return it, and a task afterward SHALL be asked rather than inherit it

#### Scenario: AC-1045 — Revoking what is not there

- **WHEN** a revocation names an acceptance that does not exist or is already revoked
- **THEN** the API SHALL respond with a structured error naming it
