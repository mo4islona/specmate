# operator-ui Specification

## Purpose

Defines what the web client must let the single owner see and do in Phase 1: launch a task,
watch it live, read its artifacts, act at its gates, and comment on everything — from a
browser or a phone. This is the surface the self-learning signal arrives through.

## Requirements

### Requirement: REQ-901 — Five screens, inbox first

The client SHALL provide five screens — the Attention Inbox, a task view, a new-task form, an
artifacts view, and a Settings screen — with the inbox as the home screen. A task list SHALL be
reachable from every screen, grouped by status with tasks needing the human pinned first and
visually distinct. Every screen SHALL be addressable by URL so a link to a task, an artifact,
or the Settings screen can be opened directly.

#### Scenario: AC-901 — Opening the app

- **WHEN** the owner opens the client's root URL
- **THEN** the Attention Inbox SHALL be shown, with the task list reachable without further navigation

#### Scenario: AC-902 — Deep link to a task

- **WHEN** a task view URL is opened directly in a fresh browser
- **THEN** that task's view SHALL load without walking through the inbox first

### Requirement: REQ-902 — The inbox puts every open item one action away

The Attention Inbox SHALL render every item the attention aggregation reports — parked gates,
failures, stalls — each naming its task, its reason, and its age, and each linking directly
to the place where the owner can act. An empty inbox SHALL state explicitly that nothing
needs the owner.

#### Scenario: AC-903 — Acting on a parked task from the inbox

- **WHEN** the inbox shows a task parked at a gate and the owner activates that item
- **THEN** the client SHALL navigate to that task with its gate actions visible

#### Scenario: AC-904 — Nothing pending

- **WHEN** the attention list is empty
- **THEN** the inbox SHALL show an explicit empty state rather than a blank screen

### Requirement: REQ-903 — Launching a task

The new-task form SHALL collect a title, a task type, a repository URL, a base branch, the
owner's request in free text, and optionally a per-role model and/or reasoning-effort override;
submit them to the task surface; and navigate to the created task's view. The request field
SHALL be the form's primary input — it is what the planner works from — and SHALL be optional.
The override control SHALL be collapsed by default so the common case stays a four-field form.
Validation failures SHALL be shown against the offending fields with the submitted input
preserved.

#### Scenario: AC-905 — Successful launch

- **WHEN** the owner submits a valid new-task form
- **THEN** the client SHALL navigate to the new task's view and the task SHALL appear in the task list without a manual reload

#### Scenario: AC-906 — Rejected intake

- **WHEN** the task surface rejects the submission naming invalid fields
- **THEN** the form SHALL mark those fields with the returned details and keep the owner's input

#### Scenario: AC-925 — Launching with a described task

- **WHEN** the owner writes a multi-paragraph request in the form and submits it
- **THEN** the request SHALL reach the task surface intact and be visible on the created task

#### Scenario: AC-948 — Overriding a role's model for one task

- **WHEN** the owner expands the override control, sets a different model and/or reasoning effort for one role, and submits
- **THEN** the create request SHALL carry that override and the new task's view SHALL show the overridden value(s) for that role

### Requirement: REQ-904 — The task view is live

The task view SHALL render the task's event log as a chronological timeline and append new
events as they stream in, without manual refresh. After a disconnect the client SHALL resume
from the last event it holds, so the timeline ends up with no gaps and no duplicated entries.
The connection state SHALL be visible when the stream is down.

#### Scenario: AC-907 — Stage completes while watching

- **WHEN** the owner has a task open and one of its stages finishes
- **THEN** the timeline SHALL show the new event without the owner acting

#### Scenario: AC-908 — Laptop lid reopened

- **WHEN** the stream was interrupted and the client reconnects
- **THEN** events appended during the interruption SHALL appear once each, in order, and the stale-connection indicator SHALL clear

### Requirement: REQ-905 — Gate actions on a parked task

When a task is parked at a human gate, its view SHALL present the gate's actions — approve,
redirect with a comment, rework with a comment — and MUST NOT present them otherwise.
Redirect and rework SHALL refuse to submit without a comment. The submitted comment SHALL be
visible in the timeline afterwards.

#### Scenario: AC-909 — Approving from the browser

- **WHEN** the owner approves a task parked at its final gate
- **THEN** the task SHALL resume and the gate actions SHALL disappear from the view

#### Scenario: AC-910 — Rework requires words

- **WHEN** the owner chooses rework and submits no comment
- **THEN** the client SHALL refuse the submission and prompt for the comment

### Requirement: REQ-906 — Feedback from anywhere

The task view SHALL always offer a comment input — not only at gates — posting to the
feedback capture endpoint, optionally pinned to a stage selected from the task's stages. A
posted comment SHALL appear in the timeline without a reload. This input SHALL be present and
usable on a phone-sized viewport.

#### Scenario: AC-911 — Commenting mid-run

- **WHEN** the owner posts a comment while a stage is running
- **THEN** the comment SHALL be accepted, appear in the timeline, and the run SHALL be unaffected

#### Scenario: AC-912 — Pinning a comment to a stage

- **WHEN** the owner selects a stage and posts a comment
- **THEN** the timeline entry SHALL show which stage the comment addresses

### Requirement: REQ-907 — Artifacts render as documents

The artifacts view SHALL list the task's artifacts by kind and render a selected artifact's
markdown as a readable document — headings, lists, tables, code blocks — not as raw text. An
artifact updated by a later stage SHALL show its fresh content when reopened.

#### Scenario: AC-913 — Reading a proposal

- **WHEN** the owner opens the task's proposal artifact
- **THEN** it SHALL render as formatted markdown

#### Scenario: AC-914 — Artifact updated between visits

- **WHEN** a stage rewrites an artifact and the owner reopens it
- **THEN** the rendered content SHALL be the updated version

### Requirement: REQ-908 — The task view charts where time and tokens went

The task view SHALL include a chart of the task's stage telemetry — duration and token usage
per stage attempt — so the owner can see at a glance which stage consumed the budget. Stages
without telemetry SHALL be shown as absent, not as zero-height bars, and a task with no
telemetry at all SHALL show an explicit empty state rather than an empty canvas.

#### Scenario: AC-915 — A task with three finished stages

- **WHEN** the owner opens a task whose stages recorded telemetry
- **THEN** the chart SHALL show each stage attempt's duration and token usage, labelled by stage

#### Scenario: AC-916 — Telemetry missing

- **WHEN** a task's stages recorded no telemetry
- **THEN** the chart area SHALL state that no telemetry exists instead of rendering an empty plot

### Requirement: REQ-909 — One theme, canvas included

The client SHALL derive all its colors and typography from a single set of design tokens, and
chart canvases SHALL be themed from those same tokens — a chart MUST NOT ship its own default
palette that clashes with the surrounding page.

#### Scenario: AC-917 — Chart matches the page

- **WHEN** the telemetry chart renders inside the task view
- **THEN** its background, axes, and series colors SHALL come from the app's design tokens

### Requirement: REQ-910 — The client authenticates as the owner

The client SHALL obtain the owner secret from the owner, send it with every API call and
stream connection, and keep it out of URLs. When the API answers that the credential is
missing or wrong, the client SHALL return to the secret prompt instead of failing silently.

#### Scenario: AC-918 — First visit

- **WHEN** the client has no stored secret and any screen is opened
- **THEN** the owner SHALL be prompted for the secret before task data is requested

#### Scenario: AC-919 — Secret rotated on the server

- **WHEN** the stored secret stops being accepted
- **THEN** the client SHALL prompt for a new secret rather than showing an endless error state

### Requirement: REQ-911 — Usable from a phone

Every screen SHALL be usable on a phone-sized viewport: no horizontal scrolling of the page,
actions reachable, forms and the comment input operable. The owner being able to comment on
everything from the browser or phone is a contract, not an aspiration.

#### Scenario: AC-920 — Approving from a phone

- **WHEN** the owner opens a parked task on a phone-sized viewport
- **THEN** the gate actions SHALL be visible and operable without horizontal scrolling

### Requirement: REQ-912 — Decisions are cards, not log lines

A decision SHALL appear in the task view as a card visually distinct from ordinary timeline
entries, rendering its question as markdown, offering its options as direct actions alongside
a free-text answer and an entry to its scoped discussion, and stating plainly when the task is
stopped on it. The discussion SHALL render as the decision's conversation rather than as
unrelated task comments. Answering or dismissing SHALL happen only through an explicit control;
afterwards the card SHALL show the outcome and offer no resolution actions while retaining its
readable discussion. Cards and discussion controls SHALL be operable on a phone-sized viewport.

#### Scenario: AC-921 — A question arrives while watching

- **WHEN** a decision is raised on a task the owner has open
- **THEN** its card SHALL appear in the timeline without a reload, marked as needing the owner

#### Scenario: AC-922 — Answering from the card

- **WHEN** the owner answers the last blocking decision from its card
- **THEN** the card SHALL show the answer and the view SHALL stop presenting the task as stopped, without a reload

#### Scenario: AC-923 — A resolved card is history

- **WHEN** a task with resolved decisions is reopened
- **THEN** their cards SHALL render the question with its answer or dismissal and offer no actions

#### Scenario: AC-924 — Answering from a phone

- **WHEN** a card with options is opened on a phone-sized viewport
- **THEN** its options and its answer input SHALL be reachable and operable without horizontal scrolling

#### Scenario: AC-933 — Discussing before answering

- **WHEN** the owner opens discussion from an unresolved decision card and asks a follow-up
- **THEN** the contextual response SHALL appear with the decision still marked unresolved and its resolution controls still available

#### Scenario: AC-934 — Proposed answer awaits confirmation

- **WHEN** the discussion proposes an answer
- **THEN** the card SHALL distinguish the proposal from the recorded outcome and require explicit confirmation before showing the decision as answered

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

### Requirement: REQ-915 — The task view surfaces live stage activity, subordinate to accepted state

While a stage is running, the task view SHALL render its activity events in the timeline, each
naming the recognized action, marked visibly as in-progress rather than accepted. Once the
stage's result is accepted, its activity events SHALL be visually demoted — collapsed or removed
— rather than left standing alongside the accepted outcome. A stage with no activity events
SHALL still show as running without implying that nothing is happening; absence of activity
events MUST NOT be presented as an error or stall.

#### Scenario: AC-940 — Activity appears while a stage runs

- **WHEN** a running stage's provider CLI reports a recognized action
- **THEN** its activity event SHALL appear in the timeline marked as in-progress, without a reload

#### Scenario: AC-941 — Accepted result demotes prior activity

- **WHEN** a stage's result is accepted after it reported activity
- **THEN** the timeline SHALL show the accepted outcome and SHALL NOT present that attempt's activity events as current

#### Scenario: AC-942 — No activity yet

- **WHEN** a stage is running and no activity has been reported
- **THEN** the task view SHALL still show it as running, without presenting the absence of activity as a failure

### Requirement: REQ-916 — Files changed, PR-style

The task view SHALL offer a Files-Changed view listing every file the task's code diff reports,
each showing its change status and line counts, reachable alongside the existing artifacts
link. Selecting a file SHALL render its unified diff as a readable document, not raw text. A
task with no product-code changes SHALL show an explicit empty state rather than a blank list.

#### Scenario: AC-943 — Opening the Files-Changed view

- **WHEN** the owner opens a task's Files-Changed view
- **THEN** every changed file SHALL be listed with its status and line counts

#### Scenario: AC-944 — Reading one file's diff

- **WHEN** the owner selects a file from the list
- **THEN** its unified diff SHALL render as a readable document

#### Scenario: AC-945 — No changes yet

- **WHEN** a task with no product-code changes opens its Files-Changed view
- **THEN** it SHALL show an explicit empty state instead of a blank list

### Requirement: REQ-917 — A Settings screen holds model defaults, built to grow

The client SHALL provide a Settings screen organized into named sections, so a later setting
becomes a new section without restructuring the screen. Its first section SHALL let the owner
view and change the default model and reasoning effort assigned to each role, reading from and
saving to the model-defaults setting; a saved change SHALL take effect for tasks created
afterward without restarting any service. The section SHALL offer a reset action that restores
every role to the shipped hardcoded defaults in one save.

#### Scenario: AC-946 — Changing a role's default model

- **WHEN** the owner changes one role's default model or reasoning effort in Settings and saves
- **THEN** a task subsequently created without an override for that role SHALL run it under the new default

#### Scenario: AC-947 — Settings screen reachable by direct URL

- **WHEN** the Settings screen's URL is opened directly in a fresh browser
- **THEN** the model defaults editor SHALL load without navigating through the inbox first

#### Scenario: AC-949 — Resetting to the shipped defaults

- **WHEN** the owner triggers the reset action after having changed one or more roles away from the shipped defaults
- **THEN** every role's stored default SHALL return to the shipped hardcoded model and reasoning effort, and a task subsequently created without an override SHALL run under those restored values

### Requirement: REQ-918 — Settings shows what the system remembers across tasks

The Settings screen SHALL carry a section listing the repositories whose coverage gap the owner
has accepted, each naming the repository and the task that accepted it, with a control revoking
one. A revoked acceptance SHALL leave the list without a reload. When none is in force, the
section SHALL say so explicitly rather than render an empty list.

#### Scenario: AC-950 — Reviewing what is in force

- **WHEN** the owner opens Settings with an accepted coverage gap in force
- **THEN** the section SHALL name the repository it applies to and the task that accepted it

#### Scenario: AC-951 — Revoking from Settings

- **WHEN** the owner revokes one from the section
- **THEN** it SHALL leave the list, and the next task with a gap in that repository SHALL be asked rather than inherit it

#### Scenario: AC-952 — Nothing remembered

- **WHEN** no repository has an accepted coverage gap
- **THEN** the section SHALL state that explicitly
