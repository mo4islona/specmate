# execution-environment Specification

## Purpose

Defines the environment a stage executes in: how a task's toolchain needs are discovered from
its repository, how the resolved environment is pinned to the task, and what a stage may assume
is installed when it starts. The repository declares what it needs; SpecMate makes that true.

## Requirements

### Requirement: REQ-801 — Repository declarations resolve to exact toolchains

A task's toolchain needs SHALL be detected by reading the target repository's own committed
declaration files and manifests, with no agent involved. Detection MUST be deterministic: the
same repository tree SHALL yield the same declarations. During workspace provisioning, every
supported declaration SHALL resolve to one exact version; a range SHALL resolve to an exact
version satisfying the range, and a versionless declaration SHALL resolve to an exact available
version. A repository that declares nothing SHALL use the baseline environment rather than
failing.

#### Scenario: AC-801 — Polyglot repository

- **WHEN** the target repository declares more than one supported language toolchain
- **THEN** the environment pin SHALL contain every declared toolchain at an exact version

#### Scenario: AC-802 — Manifest-only declaration

- **WHEN** a committed manifest declares or implies a supported toolchain without a dedicated version file
- **THEN** that toolchain SHALL be detected and resolved to an exact version

#### Scenario: AC-803 — Detection is reproducible

- **WHEN** detection runs twice against the same repository tree
- **THEN** both runs SHALL yield the same declarations

#### Scenario: AC-804 — Repository with no declarations

- **WHEN** the target repository declares no toolchains
- **THEN** the task SHALL resolve to the baseline environment and stages SHALL still run

### Requirement: REQ-802 — The complete environment is pinned per task

The resolved execution environment SHALL contain the runner image by immutable reference and
every toolchain by exact version. It SHALL be recorded on the task when its workspace is first
provisioned, and every stage of the task SHALL receive the complete pin. Later changes to the
default image, detection rules, or repository declarations MUST NOT affect a task in flight.
Changing a task's pinned environment SHALL be an explicit, recorded operation.

A pin SHALL be verified to be resolvable on the host that must run it before a stage is
dispatched against it. Where the pinned runner image cannot be resolved there, the task's runner
image SHALL be re-pinned to the one the deployment currently runs, and that substitution SHALL be
recorded on the task as the explicit operation above. The task's pinned toolchains SHALL be
carried across unchanged: a re-pin recovers the image alone, and re-deriving toolchains from the
working tree would read the task's own in-flight change. A pin that resolves MUST NOT be
re-pinned, whatever the configured default has since become.

Only a host that answers decides this. Where the host cannot be asked whether the image resolves,
nothing about the pin SHALL be treated as established: the task MUST NOT be re-pinned, its
recorded pin SHALL be left as it was, and the stage SHALL fail in a way that a further attempt
may still resolve.

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

#### Scenario: AC-819 — A re-pin recovers the image alone

- **WHEN** a task whose pinned runner image cannot be resolved is re-pinned, and its working tree declares toolchain versions other than the ones it is pinned to
- **THEN** the new pin SHALL carry the task's own pinned toolchain versions unchanged

#### Scenario: AC-820 — The host cannot be asked

- **WHEN** a stage is dispatched and whether the pinned runner image resolves cannot be determined on the host that must run it
- **THEN** the task SHALL NOT be re-pinned, its recorded pin SHALL be left as it was, and the stage's failure SHALL be one a further attempt may still resolve

### Requirement: REQ-803 — Pinned toolchains are available before the agent starts

Before a provider CLI is invoked, every toolchain in the task pin SHALL be installed and
activated at its exact pinned version. A declaration that is unsupported or cannot be resolved
or provisioned SHALL fail workspace provisioning with a message naming the toolchain and
request; no agent stage SHALL start with a wrong or missing version.

#### Scenario: AC-810 — Exact version is active

- **WHEN** a stage runs for a task with a pinned toolchain
- **THEN** invoking that toolchain inside the stage SHALL yield the exact pinned version

#### Scenario: AC-811 — Range resolves once

- **WHEN** a repository declares a satisfiable version range
- **THEN** provisioning SHALL select and record one exact satisfying version for every stage to use

#### Scenario: AC-812 — Unsatisfiable declaration

- **WHEN** a declared toolchain request cannot be satisfied
- **THEN** workspace provisioning SHALL fail naming the toolchain and request, and no agent SHALL be invoked

### Requirement: REQ-804 — Cached installs are isolated from agent stages

An exact toolchain installation provisioned once SHALL be reusable by later stages and tasks
without downloading it again. Shared installations SHALL be populated before an agent stage
starts and SHALL be read-only to the stage. Mutable toolchain-manager activation,
configuration, and state MUST NOT be shared between task stages. A cold cache MUST produce the
same resolved environment as a warm cache.

#### Scenario: AC-813 — Later stage reuses an install

- **WHEN** a stage needs an exact toolchain version that was already provisioned
- **THEN** it SHALL reuse that installation without downloading it again

#### Scenario: AC-814 — Stage cannot mutate a shared install

- **WHEN** repository code attempts to alter a shared toolchain installation during a stage
- **THEN** the write SHALL fail and later stages SHALL continue to receive the provisioned installation

#### Scenario: AC-815 — Cold cache

- **WHEN** workspace provisioning starts with an empty toolchain cache
- **THEN** it SHALL install the resolved exact versions before any stage starts
