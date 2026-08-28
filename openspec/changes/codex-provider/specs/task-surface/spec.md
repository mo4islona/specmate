## MODIFIED Requirements

### Requirement: REQ-1001 — Task intake

The API SHALL accept a new task carrying a title, a task type from the catalog, a repository
URL, a base branch, optionally the owner's request in free text, and optionally a per-role
provider, model and/or reasoning-effort override; create the task in its initial state with its
bindings resolved from that override and the current model-defaults setting; and record its creation
in the event log. When no request text is given, the title SHALL stand as the ask rather than the
task being rejected. Invalid intake MUST be rejected with a response naming every offending
field and MUST NOT create partial state.

#### Scenario: AC-1001 — Valid task submitted

- **WHEN** a create request carries a title, a known task type, a repository URL, and a branch
- **THEN** the task SHALL exist in its initial state, a creation event SHALL be appended, and the response SHALL return the task with its identity

#### Scenario: AC-1002 — Invalid intake

- **WHEN** a create request omits the title and carries an unknown task type
- **THEN** the API SHALL respond with a validation error naming both fields and no task or event SHALL be created

#### Scenario: AC-1026 — A task described in the owner's words

- **WHEN** a create request carries request text alongside the title
- **THEN** it SHALL be stored with the task and returned when the task is read

#### Scenario: AC-1038 — Launching with a model override

- **WHEN** a create request carries a model and/or reasoning-effort override for one role
- **THEN** the created task's stored bindings SHALL reflect that override for that role and the current defaults for every other role

#### Scenario: AC-1039 — Override names an unknown model or reasoning effort

- **WHEN** a create request's override names a model outside the known catalog, or a reasoning effort outside the known levels
- **THEN** intake SHALL reject it naming the offending field and no task SHALL be created

#### Scenario: AC-1085 — Launching with a provider override

- **WHEN** a create request carries a provider override for one role and names no model for it
- **THEN** the created task's binding for that role SHALL carry that provider with a model from its catalog, and every other role SHALL carry the current defaults

### Requirement: REQ-1014 — Model defaults are readable and updatable over REST

The API SHALL expose the current model-defaults setting for reading, and SHALL accept an
authenticated update naming a subset of roles and their new default provider, model and/or reasoning
effort. An update MUST be rejected, naming the offending field, if it names a role outside the
role catalog, a provider outside the configured providers, a model outside the known model catalog,
a reasoning effort outside the known levels, or a provider together with a model that provider's
catalog does not contain.

#### Scenario: AC-1040 — Reading current defaults

- **WHEN** the model-defaults setting is read
- **THEN** the response SHALL carry the current default provider, model and reasoning effort for every role

#### Scenario: AC-1041 — Updating one role's default

- **WHEN** an update names a new default provider, model or reasoning effort for one role
- **THEN** a subsequent read SHALL return that value for the role, and a task created afterward without an override for that role SHALL use it

#### Scenario: AC-1042 — Update rejected for an unknown model or reasoning effort

- **WHEN** an update names a model outside the known catalog, or a reasoning effort outside the known levels
- **THEN** the API SHALL reject it naming the offending field and the stored default SHALL remain unchanged

#### Scenario: AC-1086 — Update pairing a provider with a model it cannot run

- **WHEN** an update names a provider together with a model outside that provider's catalog
- **THEN** the API SHALL reject it naming the offending field and the stored default SHALL remain unchanged
