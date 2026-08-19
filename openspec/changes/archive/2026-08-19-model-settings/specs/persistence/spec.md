## MODIFIED Requirements

### Requirement: REQ-303 — Task identity and lifecycle fields

Each task SHALL carry a unique slug, a human title, the request it was launched with in the
owner's own words, a type of `feature` or `bugfix`, a target repository and base branch, its
current status, the resolved caps, budgets, and per-role model and reasoning-effort bindings it
runs under, the identifiers of tasks blocking it, its harness classification, and — once its
workspace has been provisioned — its pinned execution environment. Two tasks MUST NOT share a
slug.

#### Scenario: AC-304 — Duplicate slug

- **WHEN** a task is inserted with a slug that already exists
- **THEN** the database SHALL reject the insert

#### Scenario: AC-305 — Task created without explicit limits

- **WHEN** a task is created and no caps or budgets are supplied
- **THEN** the stored task SHALL carry the complete default caps and budgets as concrete values

#### Scenario: AC-306 — A cap default changes later

- **WHEN** the system's default caps are changed after a task was created
- **THEN** the existing task SHALL still report the caps it was created with

#### Scenario: AC-322 — An environment default changes later

- **WHEN** the system's default runner image changes after a task's environment was pinned
- **THEN** the existing task SHALL still report the environment it was pinned with

#### Scenario: AC-326 — Task launched without a written request

- **WHEN** a task is created with a title and no request text
- **THEN** the stored task SHALL record the absence rather than an empty request, and the title SHALL serve as the ask

#### Scenario: AC-333 — Task created without an explicit model override

- **WHEN** a task is created and no per-role model or reasoning-effort override is supplied
- **THEN** the stored task's bindings SHALL carry the current default model and reasoning effort for every role as concrete values

#### Scenario: AC-334 — A model default changes later

- **WHEN** the model-defaults setting is changed after a task was created
- **THEN** the existing task SHALL still report the model and reasoning-effort bindings it was created with

## ADDED Requirements

### Requirement: REQ-313 — Model defaults are a durable, owner-editable setting

The store SHALL persist one current default model and one current default reasoning effort per
agent role, editable independently of a code deployment, and SHALL seed a concrete default for
every role on first install so no role is ever left without one. An update SHALL persist across
a process restart and SHALL apply only to tasks created after it, never to a task's
already-resolved bindings.

#### Scenario: AC-335 — Setting persists across restart

- **WHEN** the store restarts after a role's default model or reasoning effort was changed
- **THEN** reading the setting SHALL return the changed value, not the value it held before the change

#### Scenario: AC-336 — Fresh install has a default for every role

- **WHEN** the store is queried for model defaults immediately after first install, before any owner edit
- **THEN** every agent role SHALL have a concrete default model and a concrete default reasoning effort, none absent
