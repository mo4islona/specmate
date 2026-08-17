## ADDED Requirements

### Requirement: REQ-312 — Conversations, messages, and actions are durable

Each conversation SHALL be stored with its task, optional scoped subject, lifecycle, provider
session metadata, context anchor, summary position, and timestamps. Each message SHALL carry its
conversation order, role, content, response status, per-attempt execution telemetry, and
timestamps. Each proposed or confirmed action SHALL carry its kind, target, instruction, expected
version, actor, status, and outcome. At most one assistant response MAY be active per
conversation, scoped subjects that require one discussion MUST NOT acquire duplicates, and the
database SHALL enforce both constraints. Provider session metadata is an optimization; deleting
it MUST NOT make the transcript or actions unrecoverable.

#### Scenario: AC-327 — Restart while a response is running

- **WHEN** the orchestrator restarts while a conversation response is active
- **THEN** the store alone SHALL identify the response attempt, its conversation position, and the context needed to settle or retry it

#### Scenario: AC-328 — Duplicate active response

- **WHEN** a second active response is written for a conversation that already has one
- **THEN** the database SHALL reject the statement

#### Scenario: AC-329 — Provider session metadata is lost

- **WHEN** a conversation's provider session reference is cleared
- **THEN** its ordered messages, summary position, context anchor, and actions SHALL remain readable

## MODIFIED Requirements

### Requirement: REQ-302 — Closed sets are enforced by the database

Every field with a fixed set of values — task status, agent role, provider, stage status,
review verdict, decision kind and status, artifact kind, harness status, feedback kind, pull
request state, conversation status, message role and status, and conversation-action kind and
status — SHALL be a database enum type. Writing a value outside the set MUST fail. Stage status
SHALL distinguish an owner-interrupted attempt from a failed attempt.

#### Scenario: AC-303 — Invalid status written directly

- **WHEN** a write sets any closed-set status to a value outside its defined set
- **THEN** the database SHALL reject the statement

### Requirement: REQ-309 — Feedback is captured as structured signal

Every human correction — redirect, decision answer, spec edit, rework note, overruled finding,
confirmed intervention — and every free-form operator comment and owner conversation message
SHALL be stored with the task, the stage where applicable, the role and provider it addresses,
and the prompt versions in force at the time. The closed set of feedback kinds SHALL include
`comment` for commentary outside a conversation, `conversation` for an owner message, and
`intervention` for confirmed guidance that affects execution. Capture MUST NOT depend on the
Retro agent already existing.

#### Scenario: AC-317 — Owner rejects a reviewer finding

- **WHEN** the owner overrules a finding
- **THEN** a feedback record SHALL be written naming the role, provider, and prompt versions in force

#### Scenario: AC-323 — Owner comments outside any gate

- **WHEN** the owner posts a free-form comment outside a conversation
- **THEN** a feedback record of kind `comment` SHALL be written

#### Scenario: AC-330 — Owner continues a conversation

- **WHEN** the owner posts a conversation message about a stage
- **THEN** a feedback record of kind `conversation` SHALL reference that stage, role, and provider where available

#### Scenario: AC-331 — Owner confirms an intervention

- **WHEN** the owner confirms guidance that will affect a run
- **THEN** a feedback record of kind `intervention` SHALL hold the confirmed instruction and its target

### Requirement: REQ-310 — Deleting a task removes its subordinate records

Records that exist only as part of a task — stages, run graphs, iterations, decisions,
artifacts, pull requests, feedback, events, conversations, messages, and conversation actions —
SHALL be removed when the task is deleted. References that merely point at a stage MUST be
cleared rather than cascading further.

#### Scenario: AC-318 — Task deleted

- **WHEN** a task is deleted
- **THEN** its stages, iterations, decisions, artifacts, feedback, pull requests, events, conversations, messages, and actions SHALL be removed

#### Scenario: AC-319 — Stage removed while feedback survives its task

- **WHEN** a stage referenced by feedback, a message, or an action is deleted but the task remains
- **THEN** the task-owned record SHALL survive with its stage reference cleared
