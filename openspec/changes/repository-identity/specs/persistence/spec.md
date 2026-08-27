## ADDED Requirements

### Requirement: REQ-316 — A repository is a durable record with one identity

The store SHALL hold one record per repository, created independently of any task and outliving
every task that names it. The record SHALL carry the repository's identity, the remote as the owner
wrote it, the location its working files are kept under, the specification convention the owner set
for it where one is set, and whether it is the repository a launch naming none resolves to.

Two remotes that name the same repository and differ only in spelling — transport, credentials, a
`.git` suffix, a trailing slash, letter case — SHALL resolve to one record, and the database SHALL
be what enforces that rather than the code that writes it. At most one record SHALL be the default,
also enforced by the database.

Every per-repository fact the store keeps SHALL name the record. A record SHALL be readable before
any task has run against it, because the two facts an owner states in advance — which repository is
the default, and what specification governs it — are stated about a repository that has not been
used yet.

#### Scenario: AC-346 — Two spellings of one remote

- **WHEN** a task is created against a remote spelled differently from the one an existing record holds, naming the same repository
- **THEN** it SHALL attach to that record, and the store SHALL hold one record for that repository, not two

#### Scenario: AC-347 — A repository nothing has run against

- **WHEN** the owner sets the default repository, or a specification convention, for a repository no task has named
- **THEN** the record SHALL exist and be readable, carrying what was set

#### Scenario: AC-348 — A second default

- **WHEN** a record is made the default while another record is already the default
- **THEN** exactly one record SHALL be the default afterwards

#### Scenario: AC-349 — The record outlives its tasks

- **WHEN** every task against a repository is deleted
- **THEN** the record SHALL remain, still carrying what the owner set on it

## MODIFIED Requirements

### Requirement: REQ-315 — An accepted coverage gap is durable per repository and revocable

The system SHALL durably record the owner's acceptance of a repository's coverage gap outside the
task that accepted it, naming the repository record it applies to (REQ-316), the task whose
resolution accepted it, and the moment it was revoked if it has been. At most one acceptance SHALL
be in force per repository record, enforced by the database rather than by the code that writes it.
Revoking SHALL mark the record rather than remove it, and a revoked record SHALL stay readable.
Deleting the task that accepted it MUST NOT delete the record.

#### Scenario: AC-340 — A second acceptance for one repository

- **WHEN** an acceptance is written for a repository that already has one in force
- **THEN** the database SHALL leave exactly one in force for that repository

#### Scenario: AC-341 — Revoked, not erased

- **WHEN** an acceptance is revoked
- **THEN** it SHALL remain readable with the moment it was revoked, and SHALL no longer count as in force

#### Scenario: AC-342 — The accepting task is deleted

- **WHEN** the task whose resolution accepted it is deleted
- **THEN** the acceptance SHALL survive, no longer naming a task

#### Scenario: AC-350 — One acceptance across two spellings

- **WHEN** an acceptance is written naming a spelling of a remote that already has one in force under another spelling of the same remote
- **THEN** the database SHALL leave exactly one in force
