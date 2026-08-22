## ADDED Requirements

### Requirement: REQ-315 — Owner answers that outlive a task are durable and revocable

The system SHALL durably record answers whose scope is a repository rather than a task, each
carrying the repository it applies to, which answer it is, its value, the task whose resolution
created it, and the moment it was revoked if it has been. At most one live record SHALL exist per
repository and answer, enforced by the database rather than by the code that writes it. Revoking
SHALL mark the record rather than remove it, and a revoked record SHALL stay readable. Deleting
the task that created a record MUST NOT delete the record.

#### Scenario: AC-340 — A second acceptance for one repository

- **WHEN** a record is written for a repository and answer that already has a live one
- **THEN** the database SHALL leave exactly one live record for that repository and answer

#### Scenario: AC-341 — Revoked, not erased

- **WHEN** a record is revoked
- **THEN** it SHALL remain readable with the moment it was revoked, and SHALL no longer count as live

#### Scenario: AC-342 — The originating task is deleted

- **WHEN** the task whose resolution created a record is deleted
- **THEN** the record SHALL survive, no longer naming a task
