## ADDED Requirements

### Requirement: REQ-1012 — Conversation messages and actions over REST

The API SHALL create and list a task's conversations, append owner messages, list their ordered
messages and response telemetry, and confirm a proposed action. Posting SHALL return the stored
message before its response completes. Action confirmation SHALL delegate to the orchestrator
operation that owns the requested transition; the API MUST NOT change task or stage state itself.
A direct operation SHALL stop the exact running stage without requiring a conversation or action
proposal, and a separate operation SHALL restart an owner-interrupted stage with optional
guidance entered directly or selected from a conversation proposal. Restart SHALL record the
confirmed instruction as an intervention before delegating. Both SHALL delegate to orchestrator
operations.
A confirmation whose expected task or stage version is stale SHALL be rejected as a conflict,
and a response SHALL report the action and task states that resulted. Conversation and action
events SHALL use the same resumable task stream as all other events.

#### Scenario: AC-1027 — Posting returns before the response

- **WHEN** an owner message is accepted
- **THEN** the API SHALL return its durable position and queued status without waiting for an agent response

#### Scenario: AC-1028 — Confirming a restart

- **WHEN** the owner confirms restart of the expected owner-interrupted stage after cleanup
- **THEN** the API SHALL delegate once to the orchestrator and report the stored action and resulting task state

#### Scenario: AC-1029 — Confirming against a stale stage

- **WHEN** the task no longer remains safely paused at the expected interrupted stage
- **THEN** the API SHALL return a conflict and SHALL NOT start or target another stage

#### Scenario: AC-1030 — Transcript after reconnect

- **WHEN** a client reloads and resumes the event stream during a conversation
- **THEN** the listed transcript plus later events SHALL reconstruct every message and action without duplication

#### Scenario: AC-1032 — Direct stop without a conversation

- **WHEN** the owner requests that the exact running stage stop
- **THEN** the API SHALL delegate the stop, report stopping or paused state, and require a separate restart before another attempt runs

#### Scenario: AC-1033 — Direct restart guidance is durable

- **WHEN** a restart request carries newly entered guidance for the expected interrupted stage
- **THEN** the API SHALL return the stored intervention and resulting task state, and retrying the request SHALL NOT duplicate either one
