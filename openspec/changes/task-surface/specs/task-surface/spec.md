## Purpose

Defines the authenticated HTTP contract between the store and any client: how tasks are
launched and read, how a client watches a task live and resumes without loss, how artifacts
and stage telemetry are read, how gate decisions and operator feedback are submitted. The UI
is one consumer of this contract, not a privileged one.

## ADDED Requirements

### Requirement: REQ-1001 — Task intake

The API SHALL accept a new task carrying a title, a task type from the catalog, a repository
URL, and a base branch, create the task in its initial state, and record its creation in the
event log. Invalid intake MUST be rejected with a response naming every offending field and
MUST NOT create partial state.

#### Scenario: AC-1001 — Valid task submitted

- **WHEN** a create request carries a title, a known task type, a repository URL, and a branch
- **THEN** the task SHALL exist in its initial state, a creation event SHALL be appended, and the response SHALL return the task with its identity

#### Scenario: AC-1002 — Invalid intake

- **WHEN** a create request omits the title and carries an unknown task type
- **THEN** the API SHALL respond with a validation error naming both fields and no task or event SHALL be created

### Requirement: REQ-1002 — Task reads

The API SHALL list tasks with their current status and SHALL return a single task's detail
including its pinned run graph and its stages. Reading a task that does not exist MUST yield a
not-found response, not an empty object.

#### Scenario: AC-1003 — Listing groups the sidebar

- **WHEN** the task list is requested
- **THEN** every task SHALL carry its status and enough identity (title, slug, type, timestamps) for a client to group and sort without further requests

#### Scenario: AC-1004 — Detail carries the pinned graph

- **WHEN** a task's detail is requested
- **THEN** the response SHALL include the task's pinned run graph and its stages with their statuses and attempts

### Requirement: REQ-1003 — Live event stream with resume

The API SHALL expose a server-sent event stream of the event log, ordered by sequence number,
scoped either to one task or to all tasks. A client presenting the last sequence number it
received SHALL receive every later event exactly once, in order — reconnecting MUST NOT lose
or duplicate events. Each streamed event SHALL carry its sequence number so the client always
holds a valid resume cursor.

#### Scenario: AC-1005 — Events arrive while connected

- **WHEN** a client is connected to a task's stream and a stage finishes
- **THEN** the corresponding event SHALL be delivered on the open connection without the client polling

#### Scenario: AC-1006 — Reconnect after a gap

- **WHEN** a client reconnects presenting the last sequence number it processed, and events were appended while it was away
- **THEN** the stream SHALL deliver every missed event in order before continuing live, with no gaps and no duplicates

### Requirement: REQ-1004 — The stream is authenticated like everything else

The event stream SHALL require the same owner credential as every other API endpoint. The
credential MUST NOT be accepted in a URL — query strings end up in logs and browser history.

#### Scenario: AC-1007 — Stream without credentials

- **WHEN** a stream connection is attempted without the owner credential
- **THEN** it SHALL be refused with an authentication error and no events SHALL be delivered

#### Scenario: AC-1008 — Credential offered in the URL

- **WHEN** a stream connection presents the credential only as a query parameter
- **THEN** it SHALL be refused as unauthenticated

### Requirement: REQ-1005 — Artifact reads

The API SHALL list a task's artifacts with their kind and freshness, and SHALL return a single
artifact's markdown content for rendering. Content SHALL be served from the stored snapshot so
reading never requires a workspace to exist.

#### Scenario: AC-1009 — Artifacts listed for a task

- **WHEN** a task's artifacts are requested
- **THEN** each SHALL carry its path, kind, and last-updated identity so a client can present the change folder without reading every document

#### Scenario: AC-1010 — Artifact content for rendering

- **WHEN** one artifact's content is requested
- **THEN** its markdown SHALL be returned as stored, without the API rewriting or truncating it

### Requirement: REQ-1006 — Stage telemetry reads

The API SHALL expose, per stage attempt, the execution telemetry the orchestrator records —
the provider and model that served it, start and finish times, token usage by kind, and
reported cost. Telemetry that was never recorded MUST be returned as absent, distinguishable
from zero usage.

#### Scenario: AC-1011 — Telemetry for a finished stage

- **WHEN** a stage attempt with recorded telemetry is read
- **THEN** the response SHALL include its model, timings, token usage by kind, and cost

#### Scenario: AC-1012 — Telemetry never recorded

- **WHEN** a stage attempt that predates telemetry or never ran is read
- **THEN** its telemetry SHALL read as absent, not as zeros

### Requirement: REQ-1007 — Gate operations over REST

The API SHALL expose approve, redirect-with-comment, and rework-with-comment on a task parked
at a human gate, delegating to the same gate operations the orchestrator defines — the API
MUST NOT implement transitions of its own. A gate operation on a task that is not parked at a
gate accepting it MUST be rejected without changing state. Redirect and rework MUST carry a
non-empty comment, and that comment SHALL be recorded as feedback of the corresponding kind.

#### Scenario: AC-1013 — Approve at a gate

- **WHEN** approve is submitted for a task parked at its kickoff gate
- **THEN** the task SHALL resume exactly as the orchestrator's programmatic approve would have it, and the approval SHALL appear in the event log

#### Scenario: AC-1014 — Redirect carries its comment into feedback

- **WHEN** redirect is submitted with a comment for a task parked at its kickoff gate
- **THEN** the task SHALL return to planning and a feedback record of the redirect kind SHALL hold the comment

#### Scenario: AC-1015 — Gate operation on a running task

- **WHEN** approve is submitted for a task that is not parked at any gate
- **THEN** the API SHALL reject it and the task SHALL remain unchanged

### Requirement: REQ-1008 — Operator feedback capture

The API SHALL accept a free-form operator comment on a task, optionally pinned to one of its
stages, store it as feedback of the `comment` kind, and append a corresponding event so
watching clients see it. An empty comment MUST be rejected. Capture MUST NOT depend on any
consumer existing — the Retro agent arrives later.

#### Scenario: AC-1016 — Comment on a task

- **WHEN** the operator posts a comment on a task
- **THEN** a feedback record of kind `comment` SHALL be written and an event SHALL be appended to the task's log

#### Scenario: AC-1017 — Comment pinned to a stage

- **WHEN** the operator posts a comment naming one of the task's stages
- **THEN** the feedback record SHALL reference that stage and carry the role and provider it corrects

#### Scenario: AC-1018 — Empty comment

- **WHEN** a comment with no content is posted
- **THEN** it SHALL be rejected and nothing SHALL be written

### Requirement: REQ-1009 — Attention aggregation

The API SHALL expose a single list of everything that currently needs the human, across all
tasks: tasks parked at a human gate, failed tasks, and tasks with no event activity for a
configurable stall threshold. Each item SHALL name its task, why it needs attention, and since
when. An empty list MUST mean nothing needs the human — the aggregation may not silently omit
a source it knows about.

#### Scenario: AC-1019 — Parked task appears

- **WHEN** a task parks at its spec gate
- **THEN** the attention list SHALL include it, naming the gate and the time it parked

#### Scenario: AC-1020 — Empty inbox is meaningful

- **WHEN** no task is parked, failed, or stalled
- **THEN** the attention list SHALL be empty

### Requirement: REQ-1010 — Errors are structured

Every error response SHALL be machine-readable — a stable error code plus a human-readable
detail — so the UI can distinguish validation, authentication, not-found, and conflict without
parsing prose. Internal failures MUST NOT leak stack traces or configuration to the client.

#### Scenario: AC-1021 — Validation versus conflict

- **WHEN** one request fails validation and another attempts a gate operation on a non-parked task
- **THEN** the two responses SHALL carry distinct error codes a client can branch on
