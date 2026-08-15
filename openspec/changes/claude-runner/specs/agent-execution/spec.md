## Purpose

Defines how one stage of a task is actually executed: the prompt the agent is given, the
isolation and the limits it runs under, what is done with what it produces, and how a provider's
authentication is checked before work is handed to it. This is the boundary between an
orchestrator that decides what should happen and an agent that makes it happen.

## ADDED Requirements

### Requirement: A prompt is assembled from the role's declared inputs

A stage's prompt SHALL be assembled from four sources and no others: the prompt file named by the
role's contract, the artifacts the contract declares the role reads, a rendered task ledger, and
the diff of product code changed on the task branch so far. Artifacts the role does not declare
MUST NOT be included. When the role's prompt file is absent, the stage SHALL fail with a message
naming the role and the expected file rather than running with an incomplete prompt.

#### Scenario: Undeclared artifacts are withheld

- **WHEN** a stage is prepared for a role whose contract does not list an artifact kind that exists in the change folder
- **THEN** the assembled prompt SHALL NOT contain that artifact

#### Scenario: A reviewing role sees the code

- **WHEN** a stage is prepared for a role that may not modify product code, after an earlier stage changed product code
- **THEN** the prompt SHALL carry the diff of those changes, so the role can review what was written and not only what was claimed

#### Scenario: Role prompt file missing

- **WHEN** a stage is prepared for a role whose prompt file does not exist
- **THEN** the stage SHALL fail with a message naming the role and the expected file, and no agent SHALL be invoked

#### Scenario: First stage of a task

- **WHEN** a stage is prepared and the change folder holds no artifacts and the task branch no code changes
- **THEN** the prompt SHALL still be assembled, from the role prompt and the ledger, and the stage SHALL run

### Requirement: The ledger is the only state a stage receives that is not a file

A stage SHALL receive a rendered ledger describing what the task is, which loop and round it is
in, and the findings of the previous review round. The ledger MUST NOT contain the transcript of
any earlier stage, and no other conversational state may reach the agent.

#### Scenario: Second round of a review loop

- **WHEN** a stage is prepared for a task whose previous round produced reviewer findings
- **THEN** the ledger SHALL carry those findings

#### Scenario: No transcript is carried

- **WHEN** a stage is prepared for a task that has already run other stages
- **THEN** the prompt SHALL contain no output of those stages other than the artifacts they committed and the ledger

### Requirement: A stage is isolated from service credentials and from other tasks

The environment a stage runs in SHALL expose the working tree of its own task and the provider's
stored authentication, and nothing else. Database credentials, the target-repository key, and any
other task's working tree MUST NOT be reachable from a running stage.

#### Scenario: Another task's workspace

- **WHEN** a stage runs while other tasks have provisioned workspaces
- **THEN** those workspaces SHALL NOT be readable from within the stage

#### Scenario: Service credentials

- **WHEN** a stage runs
- **THEN** the database credential and the target-repository key SHALL NOT be present in its environment or its filesystem

### Requirement: Every run is bounded in time and resources

A stage SHALL run under a wall-clock deadline and under CPU and memory ceilings. Exceeding the
deadline SHALL terminate the run and fail the stage with an outcome distinguishable from a run
that failed on its own. Resource exhaustion inside a stage MUST NOT stop the long-lived services.

#### Scenario: Run exceeds its deadline

- **WHEN** a stage has not finished by its deadline
- **THEN** the run SHALL be terminated and the stage SHALL fail, reported as timed out rather than as a provider failure

#### Scenario: A stage exhausts its memory ceiling

- **WHEN** a stage allocates beyond its memory ceiling
- **THEN** only that stage SHALL be terminated, and the orchestrator SHALL continue running

### Requirement: The execution environment is selectable and does not change behavior

The system SHALL support executing a stage either isolated from the services or in-process for
development. The assembled prompt, the parsed result, the captured log, and the reported exit
status SHALL NOT differ between them. When the process runs in production and is configured to
execute stages in-process, it SHALL refuse to start rather than run agents without isolation.

#### Scenario: The same stage in either environment

- **WHEN** one stage job is executed isolated and then in-process against the same workspace state
- **THEN** the assembled prompt SHALL be identical and the result SHALL be parsed the same way

#### Scenario: In-process execution configured in production

- **WHEN** a process starts in production configured to execute stages in-process
- **THEN** it SHALL exit with a non-zero status and an error naming the offending setting

### Requirement: Every run is recorded

A run's provider output SHALL be captured to the stage's log location in the workspace, and the
run SHALL report its exit status, its duration, and whatever usage the provider disclosed. The
log of a failed run MUST be retained, because a failure is what a human will be asked about.

#### Scenario: Failed run

- **WHEN** a stage fails
- **THEN** its captured output SHALL be retained and reachable for that stage

#### Scenario: Usage reported by the provider

- **WHEN** a provider reports token counts or cost for a run
- **THEN** those figures SHALL be returned with the stage's outcome

### Requirement: A stage's result is the one its own attempt produced

A run's structured result SHALL be read from a fixed location in the working tree after the run
completes. A result left behind by an earlier attempt MUST NOT be accepted as the current
attempt's, and the absence of a result from this attempt MUST be reported as absent.

#### Scenario: Stale result from an earlier attempt

- **WHEN** an attempt finishes without writing a result and a previous attempt's result is still present
- **THEN** the stage SHALL be treated as having produced no result

#### Scenario: Result produced by this attempt

- **WHEN** an attempt writes a valid result
- **THEN** that result SHALL be parsed and returned as the stage's outcome

### Requirement: A role may not exceed its declared write scope

After a run, the files it changed SHALL be checked against the role's contract. A role that is
not permitted to modify product code and has modified files outside the change folder SHALL fail
the stage, and its output MUST NOT be committed.

#### Scenario: A spec-writing role edits product code

- **WHEN** a run for a role that may not modify product code leaves changes outside the change folder
- **THEN** the stage SHALL fail and no commit SHALL be made

#### Scenario: An implementing role edits product code

- **WHEN** a run for a role permitted to modify product code leaves changes outside the change folder
- **THEN** the stage SHALL be accepted

### Requirement: A retry starts from committed state

Before a failed stage is attempted again, the uncommitted changes its previous attempt left
SHALL be discarded, so the new attempt reads the artifacts as they were last committed rather
than as a failed attempt half-rewrote them.

#### Scenario: Retry after a failed attempt

- **WHEN** a stage is retried after an attempt that modified artifacts and then failed
- **THEN** the new attempt SHALL run against the artifacts as of the last stage commit

### Requirement: Provider authentication is checkable without running a stage

A provider SHALL report whether its stored authentication is usable, distinguishing usable from
expired from indeterminate, without executing a stage. The report MUST NOT disclose credential
material.

#### Scenario: Expired session

- **WHEN** a provider's stored session is no longer accepted
- **THEN** its report SHALL say so, so that dependent tasks can be paused rather than failed

#### Scenario: Report contents

- **WHEN** a provider reports its authentication state
- **THEN** the report SHALL contain no token, key, or session material

### Requirement: Access to a container runtime is opt-in per stage

A stage SHALL carry a declaration of whether its role needs to start containers of its own, for
example to run a repository's own test harness. The declaration SHALL default to off, and a stage
that has not declared it MUST NOT be able to reach a container runtime.

#### Scenario: Stage that has not declared the need

- **WHEN** a stage without the declaration runs on a host that has a container runtime
- **THEN** that runtime SHALL NOT be reachable from the stage

#### Scenario: Declaration travels with the stage

- **WHEN** a stage job is prepared
- **THEN** its need for a container runtime SHALL be part of the job, so the executor can act on it without inspecting the role
