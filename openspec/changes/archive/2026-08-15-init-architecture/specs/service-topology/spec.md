## Purpose

Defines the processes SpecMate runs, how each reports whether it is alive and ready, how the
stack is brought up in dependency order, and how the single owner authenticates. This is the
substrate every later capability assumes.

## ADDED Requirements

### Requirement: Service processes

The system SHALL run as three long-lived processes — a control-plane API, an orchestrator, and
a static web client — plus a one-shot migration job. Each long-lived process MUST be
independently startable and MUST NOT require the others to be running in order to boot.

#### Scenario: API boots without the orchestrator

- **WHEN** the API process starts with a reachable database and no orchestrator running
- **THEN** it SHALL begin serving requests and report itself healthy

#### Scenario: Orchestrator boots without the API

- **WHEN** the orchestrator process starts with a reachable database and no API running
- **THEN** it SHALL begin its work loop and report itself healthy

### Requirement: Health and readiness probes

Every long-lived process SHALL expose an unauthenticated liveness endpoint at `/healthz` and an
unauthenticated readiness endpoint at `/readyz`. Liveness MUST reflect only whether the process
is running. Readiness MUST reflect whether the process can reach its database. Neither endpoint
may disclose task data, credentials, or configuration values.

#### Scenario: Liveness while the database is unreachable

- **WHEN** the database is down and `/healthz` is requested
- **THEN** the process SHALL respond `200` with `{"ok": true}`

#### Scenario: Readiness while the database is unreachable

- **WHEN** the database is down and `/readyz` is requested
- **THEN** the process SHALL respond `503` and indicate the database is unavailable

#### Scenario: Readiness with a healthy database

- **WHEN** the database is reachable and `/readyz` is requested
- **THEN** the process SHALL respond `200` and indicate the database is up

### Requirement: Single-owner authentication

The service is personal by design: it SHALL have exactly one credential, a shared secret
presented as an HTTP bearer token. All endpoints under `/api/` SHALL require it. The secret
MUST be compared in constant time. When `NODE_ENV` is `production` and no secret is configured,
the process SHALL refuse to start rather than serve unauthenticated. Outside production an
absent secret MAY leave the API open for local development.

#### Scenario: Request without credentials

- **WHEN** a request to any `/api/` endpoint carries no `Authorization` header and a secret is configured
- **THEN** the API SHALL respond `401` and perform no state change

#### Scenario: Request with an incorrect secret

- **WHEN** a request to any `/api/` endpoint carries a bearer token that does not match the configured secret
- **THEN** the API SHALL respond `401` and perform no state change

#### Scenario: Production without a configured secret

- **WHEN** the API starts with `NODE_ENV=production` and no shared secret configured
- **THEN** it SHALL exit with a non-zero status and an error naming the missing setting

#### Scenario: Probes stay reachable

- **WHEN** `/healthz` or `/readyz` is requested without credentials while a secret is configured
- **THEN** the process SHALL answer normally, because container healthchecks hold no credentials

### Requirement: Configuration is validated at startup

Each process SHALL validate its entire environment configuration before serving traffic and
SHALL exit with a non-zero status and a human-readable report naming every offending variable
when validation fails. A variable supplied as an empty string MUST be treated as unset.

#### Scenario: Missing database URL

- **WHEN** a process starts with no database URL configured
- **THEN** it SHALL exit non-zero and name the missing variable in its output

#### Scenario: Empty optional variable

- **WHEN** an optional variable is present but empty, as `.env` files and Compose produce
- **THEN** the process SHALL treat it as unset rather than as an invalid value

### Requirement: Ordered stack startup

Bringing up the stack SHALL apply database migrations to completion before any long-lived
service starts, and the database MUST be accepting connections before migrations run. A failed
migration MUST prevent the API and orchestrator from starting.

#### Scenario: Migrations fail

- **WHEN** the migration job exits non-zero during stack startup
- **THEN** the API and orchestrator SHALL NOT be started

#### Scenario: Clean start on an empty volume

- **WHEN** the stack is started against an empty database volume
- **THEN** migrations SHALL create the full schema and the services SHALL then become ready

### Requirement: Graceful shutdown

On `SIGINT` or `SIGTERM` a process SHALL stop accepting new work, release its database
connections, and exit with status `0`. Shutdown MUST NOT require the process to be killed.

#### Scenario: Termination signal

- **WHEN** a running process receives `SIGTERM`
- **THEN** it SHALL log that it is stopping and exit `0` without being force-killed

### Requirement: Network exposure defaults

Published ports SHALL bind to loopback by default. No service may be exposed on a public
interface by the default configuration; remote access is expected over a private network.

#### Scenario: Default compose configuration

- **WHEN** the stack is started with the shipped configuration
- **THEN** every published port SHALL be bound to `127.0.0.1`
