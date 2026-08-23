## MODIFIED Requirements

### Requirement: REQ-903 — Launching a task

The new-task screen SHALL collect the owner's request in free text as its only required input,
submit it to the task surface, and navigate to the created task's view. Every other field intake
accepts — the repository, an explicit base branch, and a per-role model and/or reasoning-effort
override — SHALL sit behind a control collapsed by default, so a launch that needs nothing else
is one field and one action. The screen MUST NOT ask for a title or a task type: both are
derived at intake and superseded by what planning declares. Validation failures SHALL be shown
against the offending fields with the submitted request preserved, and when the rejection names
the repository the screen SHALL offer the candidates it carried as a choice rather than an empty
field.

#### Scenario: AC-905 — Successful launch

- **WHEN** the owner submits a request the task surface accepts
- **THEN** the client SHALL navigate to the new task's view and the task SHALL appear in the task list without a manual reload

#### Scenario: AC-906 — Rejected intake

- **WHEN** the task surface rejects the submission naming invalid fields
- **THEN** the screen SHALL mark those fields with the returned details and keep the owner's request

#### Scenario: AC-925 — Launching with a described task

- **WHEN** the owner writes a multi-paragraph request and submits it
- **THEN** the request SHALL reach the task surface intact and be visible on the created task

#### Scenario: AC-948 — Overriding a role's model for one task

- **WHEN** the owner expands the collapsed control, sets a different model and/or reasoning effort for one role, and submits
- **THEN** the create request SHALL carry that override and the new task's view SHALL show the overridden value(s) for that role

#### Scenario: AC-971 — Nothing to ask

- **WHEN** the owner opens the new-task screen
- **THEN** the request input and the launch action SHALL be the only controls shown expanded, with no title, type, or repository field to fill in

#### Scenario: AC-972 — The repository could not be resolved

- **WHEN** the task surface rejects the submission naming the repository and carrying candidates
- **THEN** the screen SHALL present those candidates as a choice beside the preserved request, and choosing one and resubmitting SHALL launch the task against it

## ADDED Requirements

### Requirement: REQ-922 — Settings carries the default repository

The Settings screen SHALL carry a section naming the repositories the system knows and which of
them is the default for a launch that names none, with a control changing the default and a
control clearing it. The section SHALL let the owner name a repository nothing has run against
yet, so a fresh install can be pointed at one before its first launch. A saved change SHALL apply
to the next launch without restarting any service.

#### Scenario: AC-973 — Choosing the default repository

- **WHEN** the owner sets a repository as the default in Settings and then launches a task whose request names no repository
- **THEN** the task SHALL be created against that repository

#### Scenario: AC-974 — No repository known yet

- **WHEN** Settings is opened on an install where no task has run
- **THEN** the section SHALL state that nothing has run yet and SHALL still let the owner name a repository as the default, rather than render a choice with nothing in it
