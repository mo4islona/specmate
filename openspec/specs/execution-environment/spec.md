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
