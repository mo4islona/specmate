## ADDED Requirements

### Requirement: REQ-913 — The kickoff gate shows the brief

A task parked at its kickoff gate SHALL present the brief where its gate actions are: the
proposal rendered as a document, its key-points block visually accented, and the questions the
brief raised discussable and answerable in place. A discussion SHALL remain visibly unresolved
until the owner explicitly answers or approves the gate. Deciding on the brief MUST NOT require
navigating to the artifacts screen. When the redirect cap is spent, the redirect action SHALL be
shown as unavailable with the reason, while approve and cancel remain.

#### Scenario: AC-926 — Deciding without leaving the task view

- **WHEN** the owner opens a task parked at its kickoff gate
- **THEN** the brief SHALL be rendered in that view with its key points accented, alongside approve, redirect, and cancel

#### Scenario: AC-927 — Answering a brief question in place

- **WHEN** the brief raised a question and the owner answers it from the gate view
- **THEN** the answer SHALL be recorded and the gate actions SHALL remain available without a reload

#### Scenario: AC-928 — Regenerations spent

- **WHEN** the kickoff redirect cap is spent
- **THEN** the redirect action SHALL be presented as unavailable with the reason, and approve and cancel SHALL stay operable

#### Scenario: AC-936 — Discussing a brief question in place

- **WHEN** the owner asks for clarification on a question beside the kickoff brief
- **THEN** its contextual discussion SHALL be operable in the gate view and SHALL NOT present the question as answered

## MODIFIED Requirements

### Requirement: REQ-903 — Launching a task

The new-task form SHALL collect a title, a task type, a repository URL, a base branch, and the
owner's request in free text, submit them to the task surface, and navigate to the created
task's view. The request field SHALL be the form's primary input — it is what the planner
works from — and SHALL be optional. Validation failures SHALL be shown against the offending
fields with the submitted input preserved.

#### Scenario: AC-905 — Successful launch

- **WHEN** the owner submits a valid new-task form
- **THEN** the client SHALL navigate to the new task's view and the task SHALL appear in the task list without a manual reload

#### Scenario: AC-906 — Rejected intake

- **WHEN** the task surface rejects the submission naming invalid fields
- **THEN** the form SHALL mark those fields with the returned details and keep the owner's input

#### Scenario: AC-925 — Launching with a described task

- **WHEN** the owner writes a multi-paragraph request in the form and submits it
- **THEN** the request SHALL reach the task surface intact and be visible on the created task
