## MODIFIED Requirements

### Requirement: REQ-903 — Launching a task

The new-task form SHALL collect a title, a task type, a repository URL, a base branch, the
owner's request in free text, and optionally a per-role provider, model and/or reasoning-effort
override; submit them to the task surface; and navigate to the created task's view. The request field
SHALL be the form's primary input — it is what the planner works from — and SHALL be optional.
The override control SHALL be collapsed by default so the common case stays a four-field form.
Validation failures SHALL be shown against the offending fields with the submitted input
preserved.

The override control SHALL present a role's model choices under the provider each belongs to, and
carry that provider with the model it overrides, so an override cannot be submitted pairing a
provider with a model it cannot run.

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

#### Scenario: AC-1913 — Overriding a role's provider for one task

- **WHEN** the owner expands the override control and picks, for one role, a model belonging to another provider
- **THEN** the create request SHALL carry that model and its provider as the override for that role
