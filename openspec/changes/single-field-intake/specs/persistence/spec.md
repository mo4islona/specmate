## MODIFIED Requirements

### Requirement: REQ-303 — Task identity and lifecycle fields

Each task SHALL carry a unique slug, a human title, the request it was launched with in the
owner's own words, a type of `feature` or `bugfix`, a target repository, the base branch it runs
against once one is known, its current status, the resolved caps, budgets, and per-role model and
reasoning-effort bindings it runs under, the identifiers of tasks blocking it, the task whose plan
created it and its depth in that chain, the size its planning declared once one exists, its
harness classification, and — once its workspace has been provisioned — its pinned execution
environment. The title and the type MAY be superseded by what planning declared once it has read
the repository (REQ-1306); the slug MUST NOT change once the task exists, because it names
artefacts outside the database. A task MAY carry no base branch of its own, in which case it runs
against the repository's default as resolved at provisioning (REQ-703). Two tasks MUST NOT share
a slug.

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

#### Scenario: AC-339 — A task that predates the plan fields

- **WHEN** a task created before planning declared sizes is read
- **THEN** it SHALL report no declared size, no origin, and depth zero, and its stored caps SHALL carry every cap the current system bounds it by

#### Scenario: AC-343 — Planning renames the task

- **WHEN** planning declares a title and type for a task launched with derived ones
- **THEN** the stored task SHALL report the declared title and type, and its slug SHALL be the one it was created with

#### Scenario: AC-344 — Launched without a base branch

- **WHEN** a task is created with no base branch of its own
- **THEN** the stored task SHALL record the absence rather than a guessed branch name, and SHALL report the branch resolved at provisioning once provisioning has run
