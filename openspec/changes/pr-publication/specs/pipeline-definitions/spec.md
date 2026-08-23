## ADDED Requirements

### Requirement: REQ-406 — Action nodes: orchestrator-executed steps with no role

The catalog SHALL support action nodes alongside stage and gate nodes: a definition node with no
bound role and no human gate, executed directly by the orchestrator rather than dispatched to a
runner. An action node's forward edge SHALL be its next node in the definition, exactly as a
stage node's is. What a specific action node's key actually does when reached is not part of this
capability — that behavior belongs to whichever capability owns that node's key.

#### Scenario: AC-411 — Action node reached

- **WHEN** a task's current state is an action node
- **THEN** the orchestrator SHALL execute it directly, without dispatching a stage to a runner and without a role or provider bound to it

#### Scenario: AC-412 — Action node advances like a stage

- **WHEN** an action node completes successfully
- **THEN** the task SHALL move to that node's next node in the definition, the same forward-edge rule a stage node follows

## MODIFIED Requirements

### Requirement: REQ-405 — The feature/bugfix definition realizes the task lifecycle

The catalog SHALL contain a definition serving both feature and bugfix tasks whose shape
realizes the task-lifecycle requirements: a research⇄spec-review loop bounded by the spec cap
identity, an implementation segment whose loop edges from verification and code review both
target implementation and share the impl cap identity, the human gates the lifecycle names,
summarisation before the final gate, and an action node publishing the task before it reaches
its terminal.

#### Scenario: AC-409 — Loop identities and targets

- **WHEN** the shipped feature/bugfix definition is inspected
- **THEN** its spec-review loop edge SHALL target research under the spec cap, and its verification and code-review loop edges SHALL target implementation under the shared impl cap

#### Scenario: AC-410 — Gate inventory of the definition

- **WHEN** the shipped feature/bugfix definition's gate nodes are inspected
- **THEN** they SHALL be exactly the mandatory human gates the task lifecycle names

#### Scenario: AC-413 — Publish precedes the terminal

- **WHEN** the shipped feature/bugfix definition is inspected
- **THEN** the final human gate's approval target SHALL be the publish action node, and the publish node's forward edge SHALL be the terminal

#### Scenario: AC-420 — One node checks an implementation

- **WHEN** the shipped feature/bugfix definition's nodes between implementation and summarisation are inspected
- **THEN** exactly one SHALL carry a loop edge to implementation, and it SHALL be the node that both executes the harness and returns the verdict

