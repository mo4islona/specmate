## ADDED Requirements

### Requirement: REQ-914 — The task view supports conversation and explicit intervention

The task view SHALL present a conversation's ordered owner and assistant messages, response
progress and failure, the task state and commit each answer used, and any proposed action. An
action SHALL require a separate confirmation that names its target and effect. Restarting a
stage SHALL plainly state that uncommitted work from its interrupted attempt was discarded. A
direct `Stop current run` control SHALL be visible whenever a stage is running, independently of
conversation content; its confirmation SHALL name the stage and the loss of uncommitted work,
and its progress SHALL remain visible until the task is safely paused. Restart SHALL be a
separate control whose form SHALL accept optional guidance entered there or selected from a
conversation proposal, and confirmation SHALL show the exact instruction the replacement will
receive. The task view SHALL render the pinned pipeline with its current node, attempt number,
accepted commit, and live `running`, `stopping`, `paused`, or terminal state. Its chronological
timeline SHALL show durable stage, stop/cleanup/restart, conversation, action, decision, and
accepted-artifact events. It MUST NOT present a running attempt's uncommitted file edits as
accepted changes; new code or artifact content becomes visible only after the stage result and
commit are accepted. The transcript, pipeline, timeline, composer, stop/restart, and confirmation
controls SHALL be operable on a phone-sized viewport and update from task events without reload.

#### Scenario: AC-929 — A follow-up retains context

- **WHEN** the owner asks a follow-up from the task view
- **THEN** it SHALL appear in the existing conversation and the response SHALL render beneath it without a manual refresh

#### Scenario: AC-930 — A proposal has no implicit effect

- **WHEN** the assistant proposes restarting an owner-interrupted stage
- **THEN** the task view SHALL show a distinct confirmation control and SHALL NOT present the proposal as already applied

#### Scenario: AC-931 — Stop consequence is visible

- **WHEN** the owner opens confirmation for `Stop current run`
- **THEN** the exact running stage, possible remaining cost, and loss of uncommitted work SHALL be visible before confirmation

#### Scenario: AC-932 — A stale confirmation recovers

- **WHEN** restart confirmation conflicts because the task is no longer paused at that interrupted stage
- **THEN** the view SHALL retain the conversation, refresh task state, and offer no claim that another stage was restarted

#### Scenario: AC-935 — The owner stops without waiting for chat

- **WHEN** a stage is running and no assistant response or proposal exists
- **THEN** the task view SHALL still let the owner stop that exact run, show stopping progress, and leave the cleaned task paused with a separate restart control

#### Scenario: AC-937 — The current pipeline position is explicit

- **WHEN** the owner opens a task with an active or paused attempt
- **THEN** the pinned pipeline SHALL identify the current node, attempt, state, and last accepted commit without requiring the owner to infer them from chat

#### Scenario: AC-938 — Activity is not a live file feed

- **WHEN** a running attempt changes files before its result is accepted
- **THEN** the timeline SHALL show run activity but SHALL NOT show those edits as accepted changes, and a later accepted completion SHALL expose its commit and refreshed artifacts
