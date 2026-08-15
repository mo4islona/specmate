## Purpose

Defines the environment a stage executes in: how a task's toolchain needs are discovered from
its repository, how the resolved environment is pinned to the task, and what a stage may assume
is installed when it starts. The repository declares what it needs; SpecMate makes that true.

## ADDED Requirements

### Requirement: Toolchain needs are detected mechanically from the repository

A task's toolchain needs SHALL be detected by reading the target repository's own committed
declaration files — idiomatic version files and manifests — with no agent involved. Detection
MUST be deterministic: the same repository commit SHALL always yield the same set of declared
toolchains. A repository that declares nothing SHALL resolve to the baseline environment rather
than failing.

#### Scenario: Polyglot repository

- **WHEN** the target repository declares versions for more than one language toolchain
- **THEN** the detected set SHALL contain every declared toolchain, each at its declared version

#### Scenario: Detection is reproducible

- **WHEN** detection runs twice against the same repository commit
- **THEN** both runs SHALL yield the same environment

#### Scenario: Repository with no declarations

- **WHEN** the target repository declares no toolchain versions
- **THEN** the task SHALL resolve to the baseline environment and stages SHALL still run

### Requirement: The environment is pinned per task

The resolved execution environment — the runner image by immutable reference and the declared
toolchains — SHALL be recorded on the task when its workspace is first provisioned, and every
stage of the task SHALL run in that pinned environment. A change to the system's default image
or detection rules after the pin MUST NOT affect a task in flight. Changing a task's pinned
environment SHALL be an explicit, recorded operation, never a side effect.

#### Scenario: Default image updated mid-task

- **WHEN** the configured default runner image changes while a task is in flight
- **THEN** the task's subsequent stages SHALL still run in the environment it was pinned with

#### Scenario: All stages share one environment

- **WHEN** two stages of the same task execute
- **THEN** both SHALL run in the same pinned environment, so a difference in their outcomes cannot be an environment difference

#### Scenario: Explicit re-pin

- **WHEN** a task's environment is re-pinned
- **THEN** the change SHALL be recorded observably and only stages starting after it SHALL use the new environment

### Requirement: Declared toolchains are available before the agent starts

When a stage of a task with declared toolchains starts, those toolchains SHALL be installed at
their declared versions and reachable in the stage's environment before the provider CLI is
invoked. A declaration that cannot be satisfied SHALL fail the stage with a message naming the
toolchain and version, and the agent MUST NOT be started against a wrong or missing version.

#### Scenario: Declared version on the path

- **WHEN** a stage runs for a task whose repository declares a toolchain version
- **THEN** invoking that toolchain inside the stage SHALL yield the declared version

#### Scenario: Unsatisfiable declaration

- **WHEN** a declared toolchain version cannot be provisioned
- **THEN** the stage SHALL fail naming the toolchain and version, and no agent SHALL be invoked

### Requirement: Toolchain provisioning is cached across stages and tasks

A toolchain version that has been provisioned once SHALL be reusable by later stages and later
tasks without downloading it again. An empty cache SHALL make provisioning slower, never
incorrect: a cold start MUST yield the same environment a warm one does.

#### Scenario: Second stage reuses the install

- **WHEN** a stage starts and a prior stage already provisioned the declared toolchain version
- **THEN** the stage SHALL use the cached install rather than downloading it again

#### Scenario: Cold cache

- **WHEN** a stage starts with an empty toolchain cache
- **THEN** provisioning SHALL install the declared versions and the stage SHALL proceed normally
