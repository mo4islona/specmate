# agent-contracts Specification

## Purpose
Defines the boundary between the orchestrator and any agent: the fixed roles, what each may
read and write, the structured result every run must return, and the rule that decides which
provider reviews whose work. Providers are replaceable behind this boundary; roles are not.

## Requirements

### Requirement: REQ-101 — Roles are fixed and providers are interchangeable

The system SHALL define a fixed catalog of agent roles. Each role SHALL declare the artifact
kinds it reads, the artifact kinds it may write, whether it may modify product code, whether it
receives the house spec-standard skill, its default provider, and the file holding its prompt.
A role SHALL be bindable to any configured provider without changing the pipeline.

#### Scenario: AC-101 — Provider substituted for a role

- **WHEN** a role's provider binding is changed from one configured provider to another
- **THEN** the role's declared inputs and outputs SHALL be unchanged

#### Scenario: AC-102 — Only implementation roles touch product code

- **WHEN** the role catalog is inspected
- **THEN** exactly the implementer and verifier roles SHALL be marked as permitted to modify product code

#### Scenario: AC-103 — Spec-touching roles receive the house standard

- **WHEN** a researcher, spec writer, reviewer, or summarizer stage assembles its context
- **THEN** the current copy of the house spec-standard skill SHALL be included

### Requirement: REQ-102 — Every role consumes and produces OpenSpec artifacts

A role's input SHALL be assembled from the change folder's artifacts plus a structured task
ledger, and its output SHALL be changes to those artifacts. No stage may depend on conversation
history from an earlier stage.

#### Scenario: AC-104 — Stage prompt assembly

- **WHEN** a stage is prepared for execution
- **THEN** its prompt SHALL contain the role prompt, the current artifacts, and the ledger — and nothing carried over from a previous stage's transcript

#### Scenario: AC-105 — Rework after a summary

- **WHEN** a task is sent back for rework
- **THEN** the affected stages SHALL be re-run with context rebuilt from the updated artifacts, not from accumulated history

### Requirement: REQ-103 — Structured result contract

Every agent run SHALL end by writing a `RESULT.json` describing its outcome: a schema version,
the role that produced it, a status of `ok`, `needs_decision`, or `failed`, the artifacts it
changed, any decisions it needs answered, and a short human-facing note. Optional fields MUST
have defined defaults so a minimal valid result is accepted.

#### Scenario: AC-106 — Minimal valid result

- **WHEN** a result carries only the schema version, role, and status
- **THEN** it SHALL be accepted and the omitted collections SHALL default to empty

#### Scenario: AC-107 — Malformed result

- **WHEN** a result is not valid JSON or does not match the schema
- **THEN** parsing SHALL fail with a message identifying the offending field or syntax error

#### Scenario: AC-108 — Unknown role in a result

- **WHEN** a result names a role outside the catalog
- **THEN** it SHALL be rejected

#### Scenario: AC-109 — Missing result after a run

- **WHEN** a stage finishes without leaving a valid result
- **THEN** the stage SHALL be retried once, and a second failure SHALL escalate to the human rather than being silently ignored

### Requirement: REQ-104 — Review verdicts and stable findings

A reviewer's result SHALL carry a verdict of `approve`, `revise`, or `escalate`, and its
findings SHALL each carry an identifier that is stable across rounds, a severity, and a title.
Stable identifiers exist so that the same finding recurring across rounds is detectable.

#### Scenario: AC-110 — Reviewer requests changes

- **WHEN** a reviewer returns `revise` with findings
- **THEN** the verdict and every finding identifier SHALL be persisted for that round

#### Scenario: AC-111 — Same finding returned twice

- **WHEN** a finding with an identifier already seen in the previous round is returned again
- **THEN** the orchestrator SHALL be able to detect the repetition from the stored rounds alone

### Requirement: REQ-105 — Decisions are requested, never assumed

When an agent cannot resolve a question on its own, it SHALL request a decision rather than
choosing. Each request SHALL carry a key that is stable within its stage, a kind, a rendered
prompt, any offered options, and whether it blocks progress.

#### Scenario: AC-112 — Ambiguous requirement encountered

- **WHEN** a researcher meets a requirement it cannot resolve from the repository or the artifacts
- **THEN** its result SHALL contain a decision request rather than an assumed answer

#### Scenario: AC-113 — Question re-asked after a retry

- **WHEN** a stage is retried and asks the same question
- **THEN** the stable key SHALL let it be matched to the existing decision instead of creating a duplicate

### Requirement: REQ-106 — Cross-provider review by default

The provider reviewing a set of artifacts SHALL differ from the provider that produced them
whenever more than one provider is configured. With only one provider configured, review SHALL
proceed with that provider rather than being skipped.

#### Scenario: AC-114 — Two providers configured

- **WHEN** artifacts written by one provider enter review and another provider is configured
- **THEN** the other provider SHALL be selected as reviewer

#### Scenario: AC-115 — One provider configured

- **WHEN** only a single provider is configured
- **THEN** review SHALL still run, using that provider

### Requirement: REQ-107 — Provider adapter interface

Every provider SHALL be reachable through one interface: execute a stage job in a workspace and
return its outcome, and report the health of its authentication. A provider MUST be usable by
the orchestrator without provider-specific branching.

#### Scenario: AC-116 — Adding a provider

- **WHEN** a new provider adapter is added
- **THEN** the orchestrator SHALL require no changes beyond configuration to bind roles to it

#### Scenario: AC-117 — Expired provider credentials

- **WHEN** a provider's authentication has expired
- **THEN** its health report SHALL say so, so dependent tasks can pause rather than fail

### Requirement: REQ-108 — Reproducible standard in force

A stage that receives the house spec-standard skill SHALL record the exact revision of that
skill it ran with, so any produced artifact can be traced to the standard that governed it.

#### Scenario: AC-118 — Standard updated between runs

- **WHEN** two stages run before and after the skill is updated
- **THEN** each SHALL record a different skill revision alongside its result

### Requirement: REQ-109 — Container-runtime access follows the product-code permission

Whether a stage may reach a container runtime SHALL be derived from its role's declared
permission to modify product code: exactly the roles holding that permission SHALL be granted
the runtime, and every other role SHALL NOT, regardless of task, repository, or configuration.
No mechanism may grant the runtime to a role independently of that permission — the two are one
privilege, because code written under the permission is later executed by stages holding the
runtime.

#### Scenario: AC-119 — Code-modifying role

- **WHEN** a stage is prepared for a role permitted to modify product code
- **THEN** its job SHALL declare the need for a container runtime

#### Scenario: AC-120 — Artifact-only role on a container-testing repository

- **WHEN** a stage is prepared for a role not permitted to modify product code, on a task whose repository's test harness uses containers
- **THEN** its job SHALL NOT declare the need, and the runtime SHALL NOT be reachable from the stage
