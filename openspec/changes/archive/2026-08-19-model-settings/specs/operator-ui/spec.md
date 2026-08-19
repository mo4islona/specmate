## RENAMED Requirements

- FROM: `### Requirement: REQ-901 — Four screens, inbox first`
- TO: `### Requirement: REQ-901 — Five screens, inbox first`

## MODIFIED Requirements

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

## ADDED Requirements

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
