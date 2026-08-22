## ADDED Requirements

### Requirement: REQ-315 — Decisions that outlive their task are durable and revocable

The system SHALL durably record a decision that stays in force after the task that made it ends —
one whose scope is a repository rather than a task — each carrying the repository it applies to,
which decision it is, its value, the task whose resolution made it, and the moment it was revoked
if it has been. At most one SHALL be in force per repository and decision, enforced by the
database rather than by the code that writes it. Revoking SHALL mark the record rather than remove
it, and a revoked record SHALL stay readable. Deleting the task that made a record MUST NOT delete
the record.

#### Scenario: AC-340 — A second acceptance for one repository

- **WHEN** a record is written for a repository and decision that already has one in force
- **THEN** the database SHALL leave exactly one in force for that repository and decision

#### Scenario: AC-341 — Revoked, not erased

- **WHEN** a record is revoked
- **THEN** it SHALL remain readable with the moment it was revoked, and SHALL no longer count as in force

#### Scenario: AC-342 — The originating task is deleted

- **WHEN** the task whose resolution made a record is deleted
- **THEN** the record SHALL survive, no longer naming a task
