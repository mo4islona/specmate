## ADDED Requirements

### Requirement: REQ-315 — An accepted coverage gap is durable per repository and revocable

The system SHALL durably record the owner's acceptance of a repository's coverage gap outside the
task that accepted it, carrying the repository it applies to, the task whose resolution accepted
it, and the moment it was revoked if it has been. At most one acceptance SHALL be in force per
repository, enforced by the database rather than by the code that writes it. Revoking SHALL mark
the record rather than remove it, and a revoked record SHALL stay readable. Deleting the task that
accepted it MUST NOT delete the record.

#### Scenario: AC-340 — A second acceptance for one repository

- **WHEN** an acceptance is written for a repository that already has one in force
- **THEN** the database SHALL leave exactly one in force for that repository

#### Scenario: AC-341 — Revoked, not erased

- **WHEN** an acceptance is revoked
- **THEN** it SHALL remain readable with the moment it was revoked, and SHALL no longer count as in force

#### Scenario: AC-342 — The accepting task is deleted

- **WHEN** the task whose resolution accepted it is deleted
- **THEN** the acceptance SHALL survive, no longer naming a task
