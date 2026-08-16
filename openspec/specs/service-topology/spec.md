# service-topology Specification

## Purpose
Defines the processes SpecMate runs, how each reports whether it is alive and ready, how the
stack is brought up in dependency order, and how the single owner authenticates. This is the
substrate every later capability assumes.

## Requirements

### Requirement: REQ-501 — Service processes

The system SHALL run as three long-lived processes — a control-plane API, an orchestrator, and
a static web client — plus a one-shot migration job. Each long-lived process MUST be
independently startable and MUST NOT require the others to be running in order to boot.

Agent work SHALL NOT add a fourth long-lived process. An agent run is short-lived: the
orchestrator starts one for a single stage and discards it when that stage ends, so no agent
state survives between stages. Where agent runs are isolated from the services, the orchestrator
SHALL verify at startup that it can reach the runtime that isolates them, and SHALL exit with a
non-zero status naming the missing dependency when it cannot.

#### Scenario: AC-501 — API boots without the orchestrator

- **WHEN** the API process starts with a reachable database and no orchestrator running
- **THEN** it SHALL begin serving requests and report itself healthy

#### Scenario: AC-502 — Orchestrator boots without the API

- **WHEN** the orchestrator process starts with a reachable database and no API running
- **THEN** it SHALL begin its work loop and report itself healthy

#### Scenario: AC-503 — No agent process is started with the stack

- **WHEN** the stack is brought up
- **THEN** no long-lived agent process SHALL be started, and stages SHALL still be executable

#### Scenario: AC-504 — Isolation runtime unreachable

- **WHEN** the orchestrator starts configured to isolate agent runs and cannot reach the runtime that provides that isolation
- **THEN** it SHALL exit with a non-zero status and an error naming the dependency, rather than accepting stages it cannot execute

### Requirement: REQ-502 — Health and readiness probes

Every long-lived process SHALL expose an unauthenticated liveness endpoint at `/healthz` and an
unauthenticated readiness endpoint at `/readyz`. Liveness MUST reflect only whether the process
is running. Readiness MUST reflect whether the process can reach its database. Neither endpoint
may disclose task data, credentials, or configuration values.

#### Scenario: AC-505 — Liveness while the database is unreachable

- **WHEN** the database is down and `/healthz` is requested
- **THEN** the process SHALL respond `200` with `{"ok": true}`

#### Scenario: AC-506 — Readiness while the database is unreachable

- **WHEN** the database is down and `/readyz` is requested
- **THEN** the process SHALL respond `503` and indicate the database is unavailable

#### Scenario: AC-507 — Readiness with a healthy database

- **WHEN** the database is reachable and `/readyz` is requested
- **THEN** the process SHALL respond `200` and indicate the database is up

### Requirement: REQ-503 — Single-owner authentication

The service is personal by design: it SHALL have exactly one credential, a shared secret
presented as an HTTP bearer token. All endpoints under `/api/` SHALL require it. The secret
MUST be compared in constant time. When `NODE_ENV` is `production` and no secret is configured,
the process SHALL refuse to start rather than serve unauthenticated. Outside production an
absent secret MAY leave the API open for local development.

#### Scenario: AC-508 — Request without credentials

- **WHEN** a request to any `/api/` endpoint carries no `Authorization` header and a secret is configured
- **THEN** the API SHALL respond `401` and perform no state change

#### Scenario: AC-509 — Request with an incorrect secret

- **WHEN** a request to any `/api/` endpoint carries a bearer token that does not match the configured secret
- **THEN** the API SHALL respond `401` and perform no state change

#### Scenario: AC-510 — Production without a configured secret

- **WHEN** the API starts with `NODE_ENV=production` and no shared secret configured
- **THEN** it SHALL exit with a non-zero status and an error naming the missing setting

#### Scenario: AC-511 — Probes stay reachable

- **WHEN** `/healthz` or `/readyz` is requested without credentials while a secret is configured
- **THEN** the process SHALL answer normally, because container healthchecks hold no credentials

### Requirement: REQ-504 — Configuration is validated at startup

Each process SHALL validate its entire environment configuration before serving traffic and
SHALL exit with a non-zero status and a human-readable report naming every offending variable
when validation fails. A variable supplied as an empty string MUST be treated as unset.

#### Scenario: AC-512 — Missing database URL

- **WHEN** a process starts with no database URL configured
- **THEN** it SHALL exit non-zero and name the missing variable in its output

#### Scenario: AC-513 — Empty optional variable

- **WHEN** an optional variable is present but empty, as `.env` files and Compose produce
- **THEN** the process SHALL treat it as unset rather than as an invalid value

### Requirement: REQ-505 — Ordered stack startup

Bringing up the stack SHALL apply database migrations to completion before any long-lived
service starts, and the database MUST be accepting connections before migrations run. A failed
migration MUST prevent the API and orchestrator from starting.

#### Scenario: AC-514 — Migrations fail

- **WHEN** the migration job exits non-zero during stack startup
- **THEN** the API and orchestrator SHALL NOT be started

#### Scenario: AC-515 — Clean start on an empty volume

- **WHEN** the stack is started against an empty database volume
- **THEN** migrations SHALL create the full schema and the services SHALL then become ready

### Requirement: REQ-506 — Graceful shutdown

On `SIGINT` or `SIGTERM` a process SHALL stop accepting new work, release its database
connections, and exit with status `0`. Shutdown MUST NOT require the process to be killed.

#### Scenario: AC-516 — Termination signal

- **WHEN** a running process receives `SIGTERM`
- **THEN** it SHALL log that it is stopping and exit `0` without being force-killed

### Requirement: REQ-507 — Network exposure defaults

Published ports SHALL bind to loopback by default. No service may be exposed on a public
interface by the default configuration; remote access is expected over a private network.

#### Scenario: AC-517 — Default compose configuration

- **WHEN** the stack is started with the shipped configuration
- **THEN** every published port SHALL be bound to `127.0.0.1`
