# persistence Specification

## Purpose
Defines what SpecMate stores durably, the invariants the database itself enforces, and the
rules for evolving the schema. The store must let a restarted orchestrator answer "what was I
doing" and let the owner answer "what needs me" without replaying any chat history.

## Requirements

### Requirement: REQ-301 — Git holds artifacts, Postgres indexes them

Artifact content SHALL live in the change folder in git. The database SHALL store, per
artifact, its path, its kind, the git object it was last seen at, and a rendered snapshot used
only for display. The snapshot MUST NOT be treated as authoritative: when snapshot and git
disagree, git wins.

#### Scenario: AC-301 — Reconstructing agent context

- **WHEN** a stage assembles its prompt
- **THEN** artifact content SHALL be read from the change folder, not from the stored snapshot

#### Scenario: AC-302 — Rendering an artifact in the UI

- **WHEN** the UI displays an artifact and a snapshot exists
- **THEN** the snapshot MAY be served directly, together with the git object it came from

### Requirement: REQ-302 — Closed sets are enforced by the database

Every field with a fixed set of values — task status, agent role, provider, stage status,
review verdict, decision kind and status, artifact kind, harness status, feedback kind, pull
request state — SHALL be a database enum type. Writing a value outside the set MUST fail.

#### Scenario: AC-303 — Invalid status written directly

- **WHEN** a write sets a task's status to a value outside the defined set
- **THEN** the database SHALL reject the statement

### Requirement: REQ-303 — Task identity and lifecycle fields

Each task SHALL carry a unique slug, a human title, a type of `feature` or `bugfix`, a target
repository and base branch, its current status, the resolved caps and budgets it runs under,
the identifiers of tasks blocking it, its harness classification, and — once its workspace has
been provisioned — its pinned execution environment. Two tasks MUST NOT share a slug.

#### Scenario: AC-304 — Duplicate slug

- **WHEN** a task is inserted with a slug that already exists
- **THEN** the database SHALL reject the insert

#### Scenario: AC-305 — Task created without explicit limits

- **WHEN** a task is created and no caps or budgets are supplied
- **THEN** the stored task SHALL carry the complete default caps and budgets as concrete values

#### Scenario: AC-306 — A cap default changes later

- **WHEN** the system's default caps are changed after a task was created
- **THEN** the existing task SHALL still report the caps it was created with

#### Scenario: AC-322 — An environment default changes later

- **WHEN** the system's default runner image changes after a task's environment was pinned
- **THEN** the existing task SHALL still report the environment it was pinned with

### Requirement: REQ-304 — Stage attempts are idempotent

A stage SHALL be identified within its run graph by its node key and attempt number, and that
combination MUST be unique. Re-running an attempt after a crash MUST NOT create a second
record for the same attempt.

#### Scenario: AC-307 — Orchestrator restarts mid-stage

- **WHEN** the orchestrator restarts and resumes a stage attempt that was already recorded
- **THEN** the attempt SHALL be updated in place rather than duplicated

#### Scenario: AC-308 — Retry after failure

- **WHEN** a failed stage is retried
- **THEN** a new record SHALL be created with an incremented attempt number

### Requirement: REQ-305 — Stage attempts record execution telemetry

Each stage attempt SHALL record, alongside its outcome: the provider that ran it, the model
that actually served the run as the provider reported it, the start and finish times, the token
usage broken down by the kinds the provider reports, and the reported cost. Telemetry SHALL be
queryable per task and per stage without reading log files. Missing or unparseable telemetry
MUST NOT fail the stage and SHALL be recorded as absent, distinguishable from zero usage.

#### Scenario: AC-309 — Completed attempt inspected

- **WHEN** a completed stage attempt is read from the store
- **THEN** it SHALL carry the provider, the reported model, the start and finish times, the token counts by kind, and the reported cost

#### Scenario: AC-310 — Telemetry unparseable

- **WHEN** a stage completes but its telemetry envelope cannot be parsed
- **THEN** the stage outcome SHALL stand and the attempt's telemetry SHALL read as absent, not as zero

#### Scenario: AC-311 — Usage aggregated per task

- **WHEN** the attempts of one task are aggregated
- **THEN** the total tokens and cost per stage and per round SHALL be computable from the stored records alone

### Requirement: REQ-306 — Loop rounds are recorded once per round

Each review round SHALL record its loop (`spec` or `impl`), its round number, the reviewer's
verdict, and the findings returned. The combination of task, loop, and round MUST be unique so
that repeated-finding detection reads an unambiguous history.

#### Scenario: AC-312 — Duplicate round recorded

- **WHEN** a second record is written for a task's `spec` loop round 2
- **THEN** the database SHALL reject it

### Requirement: REQ-307 — Decisions are durable and answerable

Every question that blocks a stage SHALL be stored with a stable key, its kind, the rendered
prompt, any offered options, and its status. An answered decision SHALL additionally record the
answer, who answered, and when. Open decisions MUST be efficiently listable across all tasks so
the Attention Inbox can be built on them.

#### Scenario: AC-313 — Restart with an open decision

- **WHEN** the service restarts while a decision is unanswered
- **THEN** the decision SHALL still be listed as open with its original prompt intact

#### Scenario: AC-314 — Answering a decision

- **WHEN** a decision is answered
- **THEN** its status, answer text, answering identity, and answer time SHALL be persisted together

### Requirement: REQ-308 — The event log is append-only and ordered

Events SHALL be stored with a monotonically increasing sequence number that defines a total
order for replay and for streaming to the UI. Events MUST NOT be updated or deleted in normal
operation. A client holding a sequence number MUST be able to resume from exactly that point.

#### Scenario: AC-315 — Client reconnects

- **WHEN** a UI client reconnects holding the last sequence number it received
- **THEN** the system SHALL be able to return every later event in order, with no gaps

#### Scenario: AC-316 — Event mutation

- **WHEN** application code attempts to modify a stored event
- **THEN** this SHALL be treated as a defect; the log is append-only by contract

### Requirement: REQ-309 — Feedback is captured as structured signal

Every human correction — redirect, decision answer, spec edit, rework note, overruled finding —
SHALL be stored with the task, the stage, the role and provider it corrects, and the prompt
versions in force at the time. Capture MUST begin in Phase 0 even though nothing consumes it
until the Retro agent exists.

#### Scenario: AC-317 — Owner rejects a reviewer finding

- **WHEN** the owner overrules a finding
- **THEN** a feedback record SHALL be written naming the role, the provider, and the prompt versions in force

### Requirement: REQ-310 — Deleting a task removes its subordinate records

Records that exist only as part of a task — stages, run graphs, iterations, decisions,
artifacts, pull requests, feedback, events — SHALL be removed when the task is deleted.
References that merely point at a stage MUST be cleared rather than cascading further.

#### Scenario: AC-318 — Task deleted

- **WHEN** a task is deleted
- **THEN** its stages, iterations, decisions, artifacts, feedback, pull requests, and events SHALL be removed

#### Scenario: AC-319 — Stage removed while feedback survives its task

- **WHEN** a stage referenced by a feedback record is deleted but the task remains
- **THEN** the feedback record SHALL survive with its stage reference cleared

### Requirement: REQ-311 — Schema changes ship as reviewable migrations

Every schema change SHALL be accompanied by a generated, checked-in SQL migration and a journal
entry. Applying migrations to an empty database MUST produce the schema the code expects, and
the checked-in migrations MUST NOT drift from the schema definition.

#### Scenario: AC-320 — Schema edited without regenerating

- **WHEN** the schema definition changes and no migration is generated
- **THEN** continuous integration SHALL fail and name the missing migration

#### Scenario: AC-321 — Migrations applied twice

- **WHEN** the migration runner is executed against an already-migrated database
- **THEN** it SHALL complete successfully without reapplying prior migrations
