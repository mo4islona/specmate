## ADDED Requirements

### Requirement: REQ-508 — The providers a deployment runs are validated configuration

The set of providers a deployment runs SHALL be configuration, validated at startup against the
known provider catalog, and SHALL be what provider binding selects from. It MUST NOT be derived from
whether a provider's stored authentication currently answers: authentication expires while a task is
in flight, and a set that changed under a running task would make cross-provider checking hold or not
depending on when a credential lapsed. Whether a stored session is usable is reported separately,
per REQ-210.

Each configured provider SHALL name the CLI that runs it and SHALL keep its stored authentication
separate from every other provider's, so that a stage reaches the credential of the provider it runs
under and no other. Configuration that names a credential to be forwarded into a stage SHALL name it
per provider for the same reason.

A configured provider whose CLI cannot be found SHALL fail startup naming the provider and the CLI,
rather than being discovered when the first stage bound to it fails.

#### Scenario: AC-518 — A configured provider whose CLI is missing

- **WHEN** a process starts with a provider configured and that provider's CLI not present
- **THEN** it SHALL exit with a non-zero status naming the provider and the CLI, and no stage SHALL be accepted

#### Scenario: AC-519 — One provider configured

- **WHEN** a deployment configures a single provider
- **THEN** every stage SHALL bind to it, and checking stages SHALL run under it rather than being skipped

#### Scenario: AC-520 — A stage reaches only its own provider's credential

- **WHEN** a stage runs under one configured provider while another is also configured
- **THEN** the other provider's stored authentication and forwarded credentials SHALL NOT be reachable from that stage
