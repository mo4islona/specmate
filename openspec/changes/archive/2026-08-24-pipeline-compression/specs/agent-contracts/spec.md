## RENAMED Requirements

- FROM: `### Requirement: REQ-106 — Cross-provider review by default`
- TO: `### Requirement: REQ-106 — Cross-provider checking by default`

## ADDED Requirements

### Requirement: REQ-111 — One role both proves and judges an implementation

The role catalog SHALL contain a single validating role that executes a harness against an
implementation and returns the verdict on it. That role SHALL be permitted to write harness and
test code and its own reports, and SHALL be forbidden from modifying product code: where an
implementation is wrong, recording the failure is the result, not an obstacle to work around.

The role SHALL be bound across providers, never to the provider that produced the implementation
it is checking, whenever more than one provider is configured. Independence belongs on the stage
that proves at least as much as on the stage that asserts.

The role's report SHALL keep the two judgements separable: what an execution established, and what
the reader concluded from the diff. A verdict MUST NOT rest on the harness having passed as
though that were itself the finding — a harness that asserts nothing passes too, and this role is
the only one positioned to notice.

#### Scenario: AC-130 — The validating role's write scope

- **WHEN** the role catalog is inspected
- **THEN** the validating role SHALL be permitted to write harness code and its reports, and SHALL be denied product code

#### Scenario: AC-131 — Never the implementation's own provider

- **WHEN** an implementation written by one provider is validated and another provider is configured
- **THEN** the other provider SHALL be selected

#### Scenario: AC-132 — Execution and judgement stay separable

- **WHEN** the validating role reports an approve verdict
- **THEN** the report SHALL distinguish what its execution established from what it concluded by reading, and SHALL NOT offer a passing harness as the sole ground for approval

## MODIFIED Requirements

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
- **THEN** exactly the implementer and the validating role SHALL be marked as permitted to modify product code

#### Scenario: AC-103 — Spec-touching roles receive the house standard

- **WHEN** a stage that writes or judges specifications assembles its context
- **THEN** the current copy of the house spec-standard skill SHALL be included

### Requirement: REQ-102 — Every role consumes and produces OpenSpec artifacts

A pipeline role's input SHALL be assembled from the change folder's artifacts plus a structured
task ledger, and its output SHALL be changes to those artifacts. No pipeline stage may depend on
conversation history from an earlier stage or from an owner conversation, except where the
definition declares that a node resumes an earlier node's session: such a node SHALL carry that
session's context in addition to its artifacts and ledger, never instead of them, and the two
nodes SHALL be the same role. A resumption MUST NOT carry context between different roles, and
MUST NOT be inferred — a node that does not declare it starts cold.

A role declared answer-only is the exception to artifact output: it receives the task artifacts,
ledger, its own conversation context, and the current owner message, then produces an assistant
message and optional structured action proposals. An answer-only role MUST NOT modify artifacts,
product code, task state, gates, or decisions; its run SHALL still end with a structured result. A
confirmed intervention may reach a later pipeline stage only through the ledger rendered by the
orchestrator, never by injecting the conversation transcript.

#### Scenario: AC-104 — Stage prompt assembly

- **WHEN** a pipeline stage that declares no resumption is prepared for execution
- **THEN** its prompt SHALL contain the role prompt, current declared artifacts, and the ledger, with no transcript carried from a previous stage or owner conversation

#### Scenario: AC-105 — Rework after a summary

- **WHEN** a task is sent back for rework
- **THEN** the affected stages SHALL be re-run with context rebuilt from updated artifacts and ledger, not from accumulated history

#### Scenario: AC-126 — Conversational follow-up

- **WHEN** an answer-only role handles a follow-up in one conversation
- **THEN** it SHALL receive that conversation's stored context and produce a message without changing the task workspace

#### Scenario: AC-127 — Confirmed guidance reaches a stage

- **WHEN** the owner confirms an intervention and the target stage is dispatched
- **THEN** its ledger SHALL contain the confirmed instruction and SHALL NOT contain the surrounding conversation transcript

#### Scenario: AC-134 — A resuming stage still receives its artifacts

- **WHEN** a stage declaring resumption of an earlier node is prepared for execution
- **THEN** its prompt SHALL contain the role prompt, the current declared artifacts, and the ledger, with the earlier session continued alongside them rather than in place of them

### Requirement: REQ-106 — Cross-provider checking by default

The provider checking a body of work SHALL differ from the provider that produced it whenever more
than one provider is configured, whether the check is a reading that returns a verdict or an
execution that proves the work. With only one provider configured, the check SHALL proceed with
that provider rather than being skipped.

A node whose purpose is to check another node's output MUST NOT be bound to its role's default
provider, because a default that happens to match the producing role's default makes the
independence a coincidence rather than a property.

#### Scenario: AC-114 — Two providers configured

- **WHEN** artifacts written by one provider enter a check and another provider is configured
- **THEN** the other provider SHALL be selected as the checker

#### Scenario: AC-115 — One provider configured

- **WHEN** only a single provider is configured
- **THEN** the check SHALL still run, using that provider

#### Scenario: AC-135 — A checking node is never default-bound

- **WHEN** the shipped definitions' checking nodes are inspected
- **THEN** none SHALL be bound to its role's default provider
