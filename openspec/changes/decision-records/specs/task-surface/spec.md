## ADDED Requirements

### Requirement: REQ-1011 — Decision reads and resolution over REST

The API SHALL list a task's decisions with their kind, status, question, options, scoped
conversation identity, and answer where one exists, and SHALL expose answering and dismissing an
open decision. It SHALL accept the same resolution when the owner confirms an answer proposal
from the scoped conversation. Every path SHALL delegate to the same operations the orchestrator
defines — the API MUST NOT infer an answer from conversation prose, resume a task, write a
decision log, or implement a transition of its own. Resolving a decision that is not open MUST be
rejected as a conflict without changing state, and the response to a resolution SHALL report the
task's resulting state so a client learns whether the task resumed.

#### Scenario: AC-1022 — Answering the last blocker

- **WHEN** an answer is submitted for the last open blocking decision of a parked task
- **THEN** the task SHALL resume exactly as the orchestrator's own operation would have it, and the response SHALL report the state it resumed into

#### Scenario: AC-1023 — Resolving an already-resolved decision

- **WHEN** an answer is submitted for a decision that is already answered or dismissed
- **THEN** it SHALL be rejected as a conflict, distinguishable from a validation error, and nothing SHALL change

#### Scenario: AC-1024 — Reading a task's decisions

- **WHEN** a task's decisions are requested
- **THEN** each SHALL carry its question, kind, status, scoped conversation identity, and its answer or dismissal where one exists

#### Scenario: AC-1031 — Confirming a proposed decision answer

- **WHEN** the owner confirms an answer proposed in a decision discussion
- **THEN** the API SHALL delegate to the same answer operation as the direct decision control and report the resulting decision and task states

## MODIFIED Requirements

### Requirement: REQ-1009 — Attention aggregation

The API SHALL expose a single list of everything that currently needs the human, across all
tasks: tasks parked at a human gate, tasks with an open decision, failed tasks, and tasks with
no event activity for a configurable stall threshold. Each item SHALL name its task, why it
needs attention, and since when. An empty list MUST mean nothing needs the human — the
aggregation may not silently omit a source it knows about.

#### Scenario: AC-1019 — Parked task appears

- **WHEN** a task parks at its spec gate
- **THEN** the attention list SHALL include it, naming the gate and the time it parked

#### Scenario: AC-1020 — Empty inbox is meaningful

- **WHEN** no task is parked, failed, or stalled, and no decision is open
- **THEN** the attention list SHALL be empty

#### Scenario: AC-1025 — An open decision needs the owner

- **WHEN** a decision is raised on a task
- **THEN** the attention list SHALL include an item naming the question and the time it was raised, whether or not the decision parked the task
