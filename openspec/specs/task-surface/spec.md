# task-surface Specification

## Purpose

Defines the authenticated HTTP contract between the store and any client: how tasks are
launched and read, how a client watches a task live and resumes without loss, how artifacts
and stage telemetry are read, how gate decisions and operator feedback are submitted. The UI
is one consumer of this contract, not a privileged one.

## Requirements

### Requirement: REQ-1001 — Task intake

The API SHALL accept a new task carrying a title, a task type from the catalog, a repository
URL, a base branch, and optionally the owner's request in free text; create the task in its
initial state; and record its creation in the event log. When no request text is given, the
title SHALL stand as the ask rather than the task being rejected. Invalid intake MUST be
rejected with a response naming every offending field and MUST NOT create partial state.

#### Scenario: AC-1001 — Valid task submitted

- **WHEN** a create request carries a title, a known task type, a repository URL, and a branch
- **THEN** the task SHALL exist in its initial state, a creation event SHALL be appended, and the response SHALL return the task with its identity

#### Scenario: AC-1002 — Invalid intake

- **WHEN** a create request omits the title and carries an unknown task type
- **THEN** the API SHALL respond with a validation error naming both fields and no task or event SHALL be created

#### Scenario: AC-1026 — A task described in the owner's words

- **WHEN** a create request carries request text alongside the title
- **THEN** it SHALL be stored with the task and returned when the task is read

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

### Requirement: REQ-1010 — Errors are structured

Every error response SHALL be machine-readable — a stable error code plus a human-readable
detail — so the UI can distinguish validation, authentication, not-found, and conflict without
parsing prose. Internal failures MUST NOT leak stack traces or configuration to the client.

#### Scenario: AC-1021 — Validation versus conflict

- **WHEN** one request fails validation and another attempts a gate operation on a non-parked task
- **THEN** the two responses SHALL carry distinct error codes a client can branch on

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

### Requirement: REQ-1013 — Task code diff reads

The API SHALL return, for a task, the list of files changed in the target repository between
the task branch's merge-base with its base branch and the branch's current `HEAD`, excluding
the OpenSpec change folder, each carrying its path, change status, and added/removed line
counts; and SHALL return the unified diff for one named file from that same comparison. A task
with no product-code changes SHALL return an empty file list, not an error. The comparison MUST
NOT depend on the task's per-task workspace still existing — reading the diff of a task whose
workspace has been released after archiving SHALL return the same result as before release.

#### Scenario: AC-1034 — Files changed for a task with commits

- **WHEN** a task's code diff is requested and its branch has committed product-code changes
- **THEN** the response SHALL list every changed file with its status and line counts

#### Scenario: AC-1035 — No product-code changes yet

- **WHEN** a task's code diff is requested before any product-code commit exists
- **THEN** the response SHALL return an empty file list rather than an error

#### Scenario: AC-1036 — One file's diff

- **WHEN** one file's diff is requested by path from a task's code diff
- **THEN** the response SHALL return that file's unified diff as of the branch's current `HEAD`

#### Scenario: AC-1037 — Reading an archived task's diff

- **WHEN** a code diff is requested for a task whose workspace has been released after archiving
- **THEN** the response SHALL be the same as before release, computed from the repository's shared mirror
