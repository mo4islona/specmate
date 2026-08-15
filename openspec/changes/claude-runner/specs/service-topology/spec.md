## MODIFIED Requirements

### Requirement: Service processes

The system SHALL run as three long-lived processes — a control-plane API, an orchestrator, and
a static web client — plus a one-shot migration job. Each long-lived process MUST be
independently startable and MUST NOT require the others to be running in order to boot.

Agent work SHALL NOT add a fourth long-lived process. An agent run is short-lived: the
orchestrator starts one for a single stage and discards it when that stage ends, so no agent
state survives between stages. Where agent runs are isolated from the services, the orchestrator
SHALL verify at startup that it can reach the runtime that isolates them, and SHALL exit with a
non-zero status naming the missing dependency when it cannot.

#### Scenario: API boots without the orchestrator

- **WHEN** the API process starts with a reachable database and no orchestrator running
- **THEN** it SHALL begin serving requests and report itself healthy

#### Scenario: Orchestrator boots without the API

- **WHEN** the orchestrator process starts with a reachable database and no API running
- **THEN** it SHALL begin its work loop and report itself healthy

#### Scenario: No agent process is started with the stack

- **WHEN** the stack is brought up
- **THEN** no long-lived agent process SHALL be started, and stages SHALL still be executable

#### Scenario: Isolation runtime unreachable

- **WHEN** the orchestrator starts configured to isolate agent runs and cannot reach the runtime that provides that isolation
- **THEN** it SHALL exit with a non-zero status and an error naming the dependency, rather than accepting stages it cannot execute
