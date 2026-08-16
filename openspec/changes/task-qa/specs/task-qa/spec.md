## Purpose

Lets the owner ask an agent a question about a task and get an answer without touching the
pipeline: one-shot, read-only runs over the task's artifacts, delivered asynchronously,
recorded as self-learning signal. Clarification stops being priced like rework.

## ADDED Requirements

### Requirement: Posting an ask

The API SHALL accept a question on a task that is not in a terminal state, store it as a
pending ask, mirror it into feedback as a `question`, and append an event announcing it. An
empty question MUST be rejected, and an ask on a terminal task MUST be rejected as a
conflict. Posting SHALL never change the task's state.

#### Scenario: Question on a running task

- **WHEN** the owner posts a question while a stage is running
- **THEN** a pending ask SHALL exist, a `question` feedback record SHALL be written, an event SHALL be appended, and the task's state and running stage SHALL be untouched

#### Scenario: Question on an archived task

- **WHEN** a question is posted on an archived task
- **THEN** it SHALL be rejected as a conflict and nothing SHALL be written

### Requirement: Asks are answered by stateless read-only runs

Each ask SHALL be answered by a fresh agent run whose context is assembled from the task's
current artifacts, the ledger, and the question — never from a previous ask's transcript. The
run MUST NOT modify artifacts, product code, task state, or gate outcomes; anything it leaves
in the working tree SHALL be discarded, and nothing SHALL be committed.

#### Scenario: Two asks in a row

- **WHEN** a second ask is posted after the first was answered
- **THEN** the second run's context SHALL contain the artifacts and the second question, and nothing carried over from the first run

#### Scenario: The run strays

- **WHEN** an answering run modifies files in the workspace
- **THEN** those modifications SHALL be discarded and no commit SHALL appear on the task branch

### Requirement: Asks yield to the pipeline

Pending asks SHALL be executed only while no pipeline stage is using the task's workspace,
and SHALL be answered in the order they were posted. An ask MUST NOT delay, preempt, or block
any stage; a stage becoming runnable takes priority over a pending ask.

#### Scenario: Ask posted mid-stage

- **WHEN** an ask is posted while a stage runs, and the stage finishes
- **THEN** the next pipeline stage SHALL NOT wait on the ask, and the ask SHALL run when the workspace is next idle

#### Scenario: Several asks queued

- **WHEN** three asks are pending on an idle task
- **THEN** they SHALL be answered one at a time, oldest first

### Requirement: Answers are delivered and durable

A completed answer SHALL be stored on the ask record and appended as an event, so a client
watching the task's stream receives it without polling. A run that fails to produce an answer
SHALL be retried once; a second failure SHALL mark the ask failed with a reason, visible
wherever the ask is — an ask MUST NOT stay pending forever.

#### Scenario: Answer arrives while watching

- **WHEN** an ask completes while the owner watches the task
- **THEN** the answer SHALL appear on the stream and the stored ask SHALL read answered with the same content

#### Scenario: The answering run fails twice

- **WHEN** an ask's run fails and its single retry fails
- **THEN** the ask SHALL read failed with a reason, and no further attempts SHALL run

### Requirement: Reading asks

The API SHALL list a task's asks — question, status, answer or failure reason, timestamps —
so a client can render the full Q&A history from the store alone, without replaying events.

#### Scenario: History after a reload

- **WHEN** a client loads a task with two answered asks and one pending
- **THEN** the list SHALL return all three with their statuses and answers

### Requirement: Ask spend is recorded

Each answering attempt SHALL record the same execution telemetry as a stage attempt — the
provider and model, timings, token usage by kind, reported cost — attributed to the task.
Absent telemetry MUST be distinguishable from zero usage.

#### Scenario: Where did the tokens go

- **WHEN** a task's spend is inspected after two answered asks
- **THEN** each answering attempt SHALL be visible with its model, timings, token usage, and cost

### Requirement: Asking from the task view

The task view's input SHALL offer "ask" alongside "comment". A posted question SHALL appear
in the timeline immediately with its pending state visible, and the answer SHALL replace the
pending state without a reload. Asks SHALL be visually distinct from comments, and the
affordance SHALL be operable on a phone-sized viewport.

#### Scenario: Ask from the browser

- **WHEN** the owner submits a question from the task view
- **THEN** the timeline SHALL show the question as pending, and show the answer beneath it when it arrives, with no manual refresh

#### Scenario: Failed ask is visible

- **WHEN** an ask fails after its retry
- **THEN** the timeline SHALL show the failure and its reason where the answer would have been
