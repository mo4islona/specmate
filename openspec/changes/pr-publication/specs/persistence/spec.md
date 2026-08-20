## ADDED Requirements

### Requirement: REQ-314 — Publication writes exactly one pull request row per task

When publication succeeds, the system SHALL write exactly one `pull_requests` row for the task,
carrying its resulting URL and an initial state of `open`. A task MUST NOT accumulate more than
one such row. Updating a row's state or check status after it is written is outside this
requirement.

#### Scenario: AC-337 — First publish for a task

- **WHEN** a task publishes for the first time
- **THEN** a `pull_requests` row SHALL be written for it with state `open`

#### Scenario: AC-338 — Publish re-entered

- **WHEN** publish runs again for a task that already has a `pull_requests` row
- **THEN** no second row SHALL be written
