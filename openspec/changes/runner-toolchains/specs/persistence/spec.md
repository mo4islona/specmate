## MODIFIED Requirements

### Requirement: Task identity and lifecycle fields

Each task SHALL carry a unique slug, a human title, a type of `feature` or `bugfix`, a target
repository and base branch, its current status, the resolved caps and budgets it runs under,
the identifiers of tasks blocking it, its harness classification, and — once its workspace has
been provisioned — its pinned execution environment. Two tasks MUST NOT share a slug.

#### Scenario: Duplicate slug

- **WHEN** a task is inserted with a slug that already exists
- **THEN** the database SHALL reject the insert

#### Scenario: Task created without explicit limits

- **WHEN** a task is created and no caps or budgets are supplied
- **THEN** the stored task SHALL carry the complete default caps and budgets as concrete values

#### Scenario: A cap default changes later

- **WHEN** the system's default caps are changed after a task was created
- **THEN** the existing task SHALL still report the caps it was created with

#### Scenario: An environment default changes later

- **WHEN** the system's default runner image changes after a task's environment was pinned
- **THEN** the existing task SHALL still report the environment it was pinned with
