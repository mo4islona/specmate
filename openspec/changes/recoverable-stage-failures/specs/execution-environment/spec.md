## MODIFIED Requirements

### Requirement: REQ-802 — The complete environment is pinned per task

The resolved execution environment SHALL contain the runner image by immutable reference and
every toolchain by exact version. It SHALL be recorded on the task when its workspace is first
provisioned, and every stage of the task SHALL receive the complete pin. Later changes to the
default image, detection rules, or repository declarations MUST NOT affect a task in flight.
Changing a task's pinned environment SHALL be an explicit, recorded operation.

A pin SHALL be verified to be resolvable on the host that must run it before a stage is
dispatched against it. Where the pinned runner image cannot be resolved there, the task's
environment SHALL be re-pinned to the environment the deployment currently runs, and that
substitution SHALL be recorded on the task as the explicit operation above. A pin that resolves
MUST NOT be re-pinned, whatever the configured default has since become.

#### Scenario: AC-805 — Mutable image reference is resolved

- **WHEN** provisioning is configured with a mutable runner image reference
- **THEN** the task SHALL store the immutable image reference resolved at provisioning time

#### Scenario: AC-806 — Default image updated mid-task

- **WHEN** the configured default runner image changes while a task is in flight
- **THEN** the task's subsequent stages SHALL still use the image in its pin

#### Scenario: AC-807 — Repository declaration changes mid-task

- **WHEN** a repository toolchain declaration changes after the task was provisioned
- **THEN** subsequent stages SHALL still activate the exact toolchain versions in the task pin

#### Scenario: AC-808 — All stages share one environment

- **WHEN** two stages of the same task execute
- **THEN** both SHALL receive the same complete environment pin

#### Scenario: AC-809 — Explicit re-pin

- **WHEN** a task's environment is re-pinned
- **THEN** the change SHALL be recorded observably and only stages starting after it SHALL use the new environment

#### Scenario: AC-816 — Pinned image no longer resolvable

- **WHEN** a stage is dispatched for a task whose pinned runner image cannot be resolved on the host that must run it
- **THEN** the task SHALL be re-pinned to the environment the deployment currently runs, the substitution SHALL be recorded on the task, and the stage SHALL run against the new pin

#### Scenario: AC-817 — Pinned image still resolvable

- **WHEN** a stage is dispatched for a task whose pinned runner image resolves and whose configured default image has since changed
- **THEN** the task SHALL keep its pin and no substitution SHALL be recorded

#### Scenario: AC-818 — Nothing to re-pin to

- **WHEN** the pinned runner image cannot be resolved and neither can the environment the deployment currently runs
- **THEN** the stage SHALL fail naming the unresolvable image, and the task's recorded pin SHALL be left as it was
