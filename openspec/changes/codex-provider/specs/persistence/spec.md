## MODIFIED Requirements

### Requirement: REQ-303 — Task identity and lifecycle fields

Each task SHALL carry a unique slug, a human title, the request it was launched with in the
owner's own words, a type of `feature` or `bugfix`, a target repository and base branch, its
current status, the resolved caps, budgets, and per-role provider, model and reasoning-effort
bindings it runs under, the identifiers of tasks blocking it, the task whose plan created it and its
depth in that chain, the size its planning declared once one exists, its harness classification, and
— once its workspace has been provisioned — its pinned execution environment. Two tasks MUST NOT
share a slug.

A task stored before the provider was part of a binding SHALL read back with a concrete provider for
every role. A binding is complete or it is not a binding: a role read without one would have to be
completed by whatever read it, and two readers would complete it differently.

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

- **WHEN** a task is created and no per-role provider, model or reasoning-effort override is supplied
- **THEN** the stored task's bindings SHALL carry the current default provider, model and reasoning effort for every role as concrete values

#### Scenario: AC-334 — A model default changes later

- **WHEN** the model-defaults setting is changed after a task was created
- **THEN** the existing task SHALL still report the provider, model and reasoning-effort bindings it was created with

#### Scenario: AC-339 — A task that predates the plan fields

- **WHEN** a task created before planning declared sizes is read
- **THEN** it SHALL report no declared size, no origin, and depth zero, and its stored caps SHALL carry every cap the current system bounds it by

#### Scenario: AC-351 — A task that predates provider bindings

- **WHEN** a task stored before the provider was part of a binding is read
- **THEN** every role's binding SHALL carry a concrete provider, and its model and reasoning effort SHALL be the ones the task was created with

### Requirement: REQ-313 — Model defaults are a durable, owner-editable setting

The store SHALL persist one current default provider, one current default model and one current
default reasoning effort per agent role, editable independently of a code deployment, and SHALL seed
a concrete default for every role on first install so no role is ever left without one. An update
SHALL persist across a process restart and SHALL apply only to tasks created after it, never to a
task's already-resolved bindings.

A stored default written before the provider was part of a binding SHALL read back with a concrete
provider for every role, for the same reason a task's binding does.

#### Scenario: AC-335 — Setting persists across restart

- **WHEN** the store restarts after a role's default provider, model or reasoning effort was changed
- **THEN** reading the setting SHALL return the changed value, not the value it held before the change

#### Scenario: AC-336 — Fresh install has a default for every role

- **WHEN** the store is queried for model defaults immediately after first install, before any owner edit
- **THEN** every agent role SHALL have a concrete default provider, model and reasoning effort, none absent

#### Scenario: AC-352 — Defaults stored before providers were bound

- **WHEN** the model-defaults setting written before the provider was part of a binding is read
- **THEN** every role SHALL report a concrete provider, and the models and reasoning efforts already stored SHALL be unchanged
