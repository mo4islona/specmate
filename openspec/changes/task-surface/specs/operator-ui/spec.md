## Purpose

Defines what the web client must let the single owner see and do in Phase 1: launch a task,
watch it live, read its artifacts, act at its gates, and comment on everything — from a
browser or a phone. This is the surface the self-learning signal arrives through.

## ADDED Requirements

### Requirement: Four screens, inbox first

The client SHALL provide four screens — the Attention Inbox, a task view, a new-task form,
and an artifacts view — with the inbox as the home screen. A task list SHALL be reachable
from every screen, grouped by status with tasks needing the human pinned first and visually
distinct. Every screen SHALL be addressable by URL so a link to a task or an artifact can be
opened directly.

#### Scenario: Opening the app

- **WHEN** the owner opens the client's root URL
- **THEN** the Attention Inbox SHALL be shown, with the task list reachable without further navigation

#### Scenario: Deep link to a task

- **WHEN** a task view URL is opened directly in a fresh browser
- **THEN** that task's view SHALL load without walking through the inbox first

### Requirement: The inbox puts every open item one action away

The Attention Inbox SHALL render every item the attention aggregation reports — parked gates,
failures, stalls — each naming its task, its reason, and its age, and each linking directly
to the place where the owner can act. An empty inbox SHALL state explicitly that nothing
needs the owner.

#### Scenario: Acting on a parked task from the inbox

- **WHEN** the inbox shows a task parked at a gate and the owner activates that item
- **THEN** the client SHALL navigate to that task with its gate actions visible

#### Scenario: Nothing pending

- **WHEN** the attention list is empty
- **THEN** the inbox SHALL show an explicit empty state rather than a blank screen

### Requirement: Launching a task

The new-task form SHALL collect a title, a task type, a repository URL, and a base branch,
submit them to the task surface, and navigate to the created task's view. Validation failures
SHALL be shown against the offending fields with the submitted input preserved.

#### Scenario: Successful launch

- **WHEN** the owner submits a valid new-task form
- **THEN** the client SHALL navigate to the new task's view and the task SHALL appear in the task list without a manual reload

#### Scenario: Rejected intake

- **WHEN** the task surface rejects the submission naming invalid fields
- **THEN** the form SHALL mark those fields with the returned details and keep the owner's input

### Requirement: The task view is live

The task view SHALL render the task's event log as a chronological timeline and append new
events as they stream in, without manual refresh. After a disconnect the client SHALL resume
from the last event it holds, so the timeline ends up with no gaps and no duplicated entries.
The connection state SHALL be visible when the stream is down.

#### Scenario: Stage completes while watching

- **WHEN** the owner has a task open and one of its stages finishes
- **THEN** the timeline SHALL show the new event without the owner acting

#### Scenario: Laptop lid reopened

- **WHEN** the stream was interrupted and the client reconnects
- **THEN** events appended during the interruption SHALL appear once each, in order, and the stale-connection indicator SHALL clear

### Requirement: Gate actions on a parked task

When a task is parked at a human gate, its view SHALL present the gate's actions — approve,
redirect with a comment, rework with a comment — and MUST NOT present them otherwise.
Redirect and rework SHALL refuse to submit without a comment. The submitted comment SHALL be
visible in the timeline afterwards.

#### Scenario: Approving from the browser

- **WHEN** the owner approves a task parked at its final gate
- **THEN** the task SHALL resume and the gate actions SHALL disappear from the view

#### Scenario: Rework requires words

- **WHEN** the owner chooses rework and submits no comment
- **THEN** the client SHALL refuse the submission and prompt for the comment

### Requirement: Feedback from anywhere

The task view SHALL always offer a comment input — not only at gates — posting to the
feedback capture endpoint, optionally pinned to a stage selected from the task's stages. A
posted comment SHALL appear in the timeline without a reload. This input SHALL be present and
usable on a phone-sized viewport.

#### Scenario: Commenting mid-run

- **WHEN** the owner posts a comment while a stage is running
- **THEN** the comment SHALL be accepted, appear in the timeline, and the run SHALL be unaffected

#### Scenario: Pinning a comment to a stage

- **WHEN** the owner selects a stage and posts a comment
- **THEN** the timeline entry SHALL show which stage the comment addresses

### Requirement: Artifacts render as documents

The artifacts view SHALL list the task's artifacts by kind and render a selected artifact's
markdown as a readable document — headings, lists, tables, code blocks — not as raw text. An
artifact updated by a later stage SHALL show its fresh content when reopened.

#### Scenario: Reading a proposal

- **WHEN** the owner opens the task's proposal artifact
- **THEN** it SHALL render as formatted markdown

#### Scenario: Artifact updated between visits

- **WHEN** a stage rewrites an artifact and the owner reopens it
- **THEN** the rendered content SHALL be the updated version

### Requirement: The task view charts where time and tokens went

The task view SHALL include a chart of the task's stage telemetry — duration and token usage
per stage attempt — so the owner can see at a glance which stage consumed the budget. Stages
without telemetry SHALL be shown as absent, not as zero-height bars, and a task with no
telemetry at all SHALL show an explicit empty state rather than an empty canvas.

#### Scenario: A task with three finished stages

- **WHEN** the owner opens a task whose stages recorded telemetry
- **THEN** the chart SHALL show each stage attempt's duration and token usage, labelled by stage

#### Scenario: Telemetry missing

- **WHEN** a task's stages recorded no telemetry
- **THEN** the chart area SHALL state that no telemetry exists instead of rendering an empty plot

### Requirement: One theme, canvas included

The client SHALL derive all its colors and typography from a single set of design tokens, and
chart canvases SHALL be themed from those same tokens — a chart MUST NOT ship its own default
palette that clashes with the surrounding page.

#### Scenario: Chart matches the page

- **WHEN** the telemetry chart renders inside the task view
- **THEN** its background, axes, and series colors SHALL come from the app's design tokens

### Requirement: The client authenticates as the owner

The client SHALL obtain the owner secret from the owner, send it with every API call and
stream connection, and keep it out of URLs. When the API answers that the credential is
missing or wrong, the client SHALL return to the secret prompt instead of failing silently.

#### Scenario: First visit

- **WHEN** the client has no stored secret and any screen is opened
- **THEN** the owner SHALL be prompted for the secret before task data is requested

#### Scenario: Secret rotated on the server

- **WHEN** the stored secret stops being accepted
- **THEN** the client SHALL prompt for a new secret rather than showing an endless error state

### Requirement: Usable from a phone

Every screen SHALL be usable on a phone-sized viewport: no horizontal scrolling of the page,
actions reachable, forms and the comment input operable. The plan's requirement that the
owner can "comment on everything from the browser/phone" is a contract, not an aspiration.

#### Scenario: Approving from a phone

- **WHEN** the owner opens a parked task on a phone-sized viewport
- **THEN** the gate actions SHALL be visible and operable without horizontal scrolling
