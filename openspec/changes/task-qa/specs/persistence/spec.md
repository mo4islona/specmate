## ADDED Requirements

### Requirement: Asks are durable with a status lifecycle

Each ask SHALL be stored with its task, its question, a status from the closed set `pending`,
`answering`, `answered`, `failed`, the answer or failure reason once resolved, per-attempt
execution telemetry, and timestamps for creation and resolution. The status set SHALL be
enforced by the database. Asks SHALL be removed when their task is deleted.

#### Scenario: Restart while answering

- **WHEN** the orchestrator restarts while an ask is answering
- **THEN** the store alone SHALL say which ask was in flight, so it can be re-run under its retry cap

#### Scenario: Task deleted

- **WHEN** a task with asks is deleted
- **THEN** its asks SHALL be removed with it

## MODIFIED Requirements

### Requirement: Feedback is captured as structured signal

Every human correction — redirect, decision answer, spec edit, rework note, overruled
finding — and every free-form operator comment and question SHALL be stored with the task,
the stage, the role and provider it corrects, and the prompt versions in force at the time.
The closed set of feedback kinds SHALL include `comment` for commentary not tied to a gate
verdict or a decision answer, and `question` for questions the owner asks about a task —
what the owner has to ask is what the artifacts failed to make clear. Capture MUST begin in
Phase 0 even though nothing consumes it until the Retro agent exists.

#### Scenario: Owner rejects a reviewer finding

- **WHEN** the owner overrules a finding
- **THEN** a feedback record SHALL be written naming the role, the provider, and the prompt versions in force

#### Scenario: Owner comments outside any gate

- **WHEN** the owner posts a free-form comment on a running task
- **THEN** a feedback record of kind `comment` SHALL be written, and the database SHALL accept `comment` as a legal feedback kind

#### Scenario: Owner asks a question

- **WHEN** the owner posts a question on a task
- **THEN** a feedback record of kind `question` SHALL be written alongside the ask itself
