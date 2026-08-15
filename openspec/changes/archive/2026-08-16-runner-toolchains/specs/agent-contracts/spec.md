## ADDED Requirements

### Requirement: REQ-1 — Container-runtime access follows the product-code permission

Whether a stage may reach a container runtime SHALL be derived from its role's declared
permission to modify product code: exactly the roles holding that permission SHALL be granted
the runtime, and every other role SHALL NOT, regardless of task, repository, or configuration.
No mechanism may grant the runtime to a role independently of that permission — the two are one
privilege, because code written under the permission is later executed by stages holding the
runtime.

#### Scenario: AC-1 — Code-modifying role

- **WHEN** a stage is prepared for a role permitted to modify product code
- **THEN** its job SHALL declare the need for a container runtime

#### Scenario: AC-2 — Artifact-only role on a container-testing repository

- **WHEN** a stage is prepared for a role not permitted to modify product code, on a task whose repository's test harness uses containers
- **THEN** its job SHALL NOT declare the need, and the runtime SHALL NOT be reachable from the stage
