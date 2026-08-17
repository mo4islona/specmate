## Purpose

Lets an owner hold a durable, contextual conversation about one task, then deliberately turn an
agreed message into a controlled task action without making conversation itself a hidden control
plane.

## ADDED Requirements

### Requirement: REQ-1601 — Conversations are durable and scoped to one task

The system SHALL let the owner open a conversation on any non-terminal task. Each conversation
SHALL belong to exactly one task and MAY additionally name one process-created subject, such as a
decision or gate. Its ordered transcript and lifecycle SHALL be readable from the store alone.
Posting to a terminal task MUST be rejected, while an existing transcript SHALL remain readable.

#### Scenario: AC-1601 — A task conversation is opened

- **WHEN** the owner opens a conversation on an active task
- **THEN** a durable conversation SHALL exist for that task without changing the task's state

#### Scenario: AC-1602 — A conversation is scoped to a decision

- **WHEN** a process creates a discussion for a decision
- **THEN** the conversation SHALL identify both its task and that decision without becoming the decision record

#### Scenario: AC-1603 — A terminal task receives a message

- **WHEN** the owner posts a new message to an archived or cancelled task
- **THEN** the post SHALL be rejected and the existing transcript SHALL remain unchanged

### Requirement: REQ-1602 — Messages form an ordered recoverable exchange

An accepted owner message SHALL be appended durably before any agent response starts. Messages
within a conversation SHALL have a total order, a role, content, status, and timestamps. At most
one assistant response MAY run for a conversation at a time; additional owner messages SHALL
queue in order. A response that fails to produce a complete message SHALL retry once, then remain
visible as failed with its reason instead of blocking later messages forever.

#### Scenario: AC-1604 — Two follow-ups arrive together

- **WHEN** two owner messages are posted while a response is running
- **THEN** both SHALL be stored immediately and answered one at a time in their stored order

#### Scenario: AC-1605 — A response fails twice

- **WHEN** a response attempt and its single retry both fail
- **THEN** the assistant message SHALL read failed with a reason and the next queued message SHALL remain runnable

### Requirement: REQ-1603 — Conversation context survives runtime loss

Each assistant turn SHALL receive the conversation's prior exchange, the task ledger, the
current task artifacts and product-code diff, and the new owner message. The store SHALL be the
source of truth for that context: an opaque provider session or a warm runtime MAY accelerate a
turn but MUST NOT be required to reconstruct it. A bounded summary MAY replace older transcript
text, provided the full transcript remains stored and the summary's source position is recorded.
Pipeline stages MUST NOT receive conversation transcript; only confirmed interventions rendered
into their ledger may reach them.

#### Scenario: AC-1606 — Follow-up refers to the previous answer

- **WHEN** the owner asks a follow-up whose meaning depends on the previous exchange
- **THEN** the response context SHALL include that exchange or its recorded summary and SHALL NOT require the owner to quote it

#### Scenario: AC-1607 — Warm state is gone

- **WHEN** a provider session, container, or orchestrator disappears between turns
- **THEN** the next turn SHALL be reconstructable from stored conversation state and current task context

#### Scenario: AC-1608 — A stage runs after a discussion

- **WHEN** a pipeline stage is dispatched after an unconfirmed conversation
- **THEN** its prompt SHALL contain none of that transcript or its assistant proposals

### Requirement: REQ-1604 — Session reuse is bounded and observable

The system MAY reuse one provider session and one warm runtime for consecutive turns of a
conversation within a configured idle TTL. Once that TTL expires, the runtime SHALL be released
without closing the conversation. Every response attempt SHALL record its provider, model,
timings, token usage, reported cost, and whether stored context, cached context, or reconstructed
context served the turn; absent usage MUST remain distinguishable from zero.

#### Scenario: AC-1609 — Follow-up within the idle TTL

- **WHEN** a follow-up arrives while the conversation runtime remains reusable
- **THEN** the same session MAY serve it and the response telemetry SHALL identify the reused context path

#### Scenario: AC-1610 — Follow-up after the idle TTL

- **WHEN** a follow-up arrives after the warm runtime was released
- **THEN** a reconstructed session SHALL answer it without losing the conversation history

### Requirement: REQ-1605 — Conversation responses do not wait for or mutate a stage

A conversation response SHALL run against a disposable snapshot anchored to a task commit and
SHALL NOT use the task's primary working tree. It MAY run while a pipeline stage is active and
MUST NOT delay, preempt, or advance that stage unless the owner separately confirms an
intervention. The response SHALL identify the task state and commit it understood; a later turn
SHALL receive task-state and artifact changes since that anchor. Any file changes or commits made
inside the disposable snapshot SHALL be discarded.

#### Scenario: AC-1611 — The owner asks while implementation runs

- **WHEN** an owner message arrives while a stage owns the task workspace
- **THEN** its response MAY run concurrently from a disposable commit snapshot and the stage SHALL remain untouched

#### Scenario: AC-1612 — The task changes between turns

- **WHEN** a stage commits and advances the task after one assistant response
- **THEN** the next response SHALL be told the new state and artifact changes and SHALL identify its newer context anchor

#### Scenario: AC-1613 — The conversational run writes files

- **WHEN** a response run modifies or commits files in its disposable snapshot
- **THEN** those changes SHALL be discarded and the task branch SHALL remain unchanged

### Requirement: REQ-1606 — Only a confirmed action influences the task

An assistant response MAY propose a structured task action, but a proposal SHALL have no effect
until the owner confirms that exact action. Confirmation SHALL durably record the actor, action
kind, target, instruction, and expected task or stage version before delegating to the
orchestrator operation that owns the transition. Supported actions SHALL include resolving a
decision, invoking a legal gate action, attaching an instruction to a future run, and
restarting an owner-interrupted stage. Stopping a running stage SHALL also be available as a
direct owner control and MUST NOT depend on an assistant proposal. An ordinary message, an
assistant response, or an unconfirmed proposal MUST NOT change task state or agent context.

#### Scenario: AC-1614 — The assistant suggests rework

- **WHEN** an assistant message proposes rework and the owner continues chatting without confirming it
- **THEN** the task and every stage prompt SHALL remain unchanged

#### Scenario: AC-1615 — The owner confirms an action

- **WHEN** the owner confirms a proposed action against the expected live task version
- **THEN** the action SHALL be stored and delegated once to the owning orchestrator operation

#### Scenario: AC-1616 — The target changed before confirmation

- **WHEN** an action is confirmed after its expected task or stage version is no longer current
- **THEN** it SHALL be rejected as a conflict without applying to a different target

### Requirement: REQ-1607 — The owner can stop a run and deliberately restart its stage

The task view SHALL offer a direct stop control whenever a stage is running. A stop naming the
exact running stage SHALL atomically win that stage or fail as a conflict. When it wins, the task
SHALL stop dispatching and remain paused, the attempt SHALL become `interrupted`, its execution
SHALL be terminated, and its uncommitted workspace changes SHALL be discarded. A separate
restart action MAY then return the task to the same pinned graph node for a new attempt and MAY
carry either an instruction entered in the restart form or a confirmed conversation proposal.
The owner SHALL confirm the exact instruction and interrupted target before restart, and only
that stored intervention SHALL enter the replacement's ledger. Restart MUST NOT become available
until termination and cleanup succeed. A result arriving from the interrupted execution MUST
NOT be committed, complete the stage, or advance the task. An interrupted attempt SHALL remain
in history and count towards spend, but MUST NOT count as a failure or consume the stage failure
cap.

#### Scenario: AC-1617 — A running stage is stopped and restarted with guidance

- **WHEN** the owner stops the current run and later restarts its stage with confirmed guidance
- **THEN** the old attempt SHALL remain interrupted, its uncommitted work SHALL be gone, and a new attempt at the same node SHALL receive the instruction

#### Scenario: AC-1618 — The stage finishes first

- **WHEN** the named stage completes before the stop operation claims it
- **THEN** the stop SHALL be rejected as a conflict and no later stage SHALL be interrupted in its place

#### Scenario: AC-1619 — The killed execution reports success late

- **WHEN** an interrupted execution returns a successful result after interruption won
- **THEN** the result SHALL be ignored and SHALL NOT create a commit or transition

#### Scenario: AC-1620 — Cleanup cannot be completed

- **WHEN** the execution or workspace cannot be safely terminated and cleaned
- **THEN** the task SHALL remain paused, the action SHALL read failed with a reason, and no replacement attempt SHALL start

#### Scenario: AC-1623 — Stop without immediate restart

- **WHEN** the owner activates the direct stop control and supplies no restart instruction
- **THEN** the run SHALL be interrupted and cleaned while the task remains paused until a later explicit restart or cancellation

#### Scenario: AC-1624 — Restart with a newly entered instruction

- **WHEN** the owner enters guidance in the restart form and confirms the expected interrupted stage
- **THEN** one immutable intervention SHALL store that exact guidance and the replacement attempt SHALL receive it without the surrounding conversation

### Requirement: REQ-1608 — Conversation and action history are delivered live

The API SHALL expose a task's conversations, their ordered messages, proposed actions, confirmed
actions, and response telemetry from the store. Creation, response, failure, proposal,
confirmation, application, and conflict SHALL append events so a watching client updates without
reload. The task view SHALL present the transcript and action state as one conversation surface,
show which task version an answer used, and make confirmation operable on a phone-sized viewport.
Stop confirmation SHALL state that uncommitted work and the current run's remaining cost may be
lost before the owner confirms it. Restart confirmation SHALL name the interrupted stage and any
guidance the replacement will consume. While a stage is running, a direct stop control SHALL be
visible independently of assistant output and SHALL show progress until termination and cleanup
settle.

#### Scenario: AC-1621 — Conversation reloads mid-response

- **WHEN** the owner reloads a task while an assistant response is running
- **THEN** the stored transcript SHALL show the response in progress and later resolve it from an event

#### Scenario: AC-1622 — Restart is confirmed from a phone

- **WHEN** the owner reviews a restart proposal on a phone-sized viewport
- **THEN** the interrupted target stage, optional instruction, and new-attempt consequence SHALL be visible and confirmable without horizontal scrolling
