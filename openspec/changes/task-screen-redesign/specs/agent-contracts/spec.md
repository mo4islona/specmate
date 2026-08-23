## MODIFIED Requirements

### Requirement: REQ-102 — Every role consumes and produces OpenSpec artifacts

A pipeline role's input SHALL be assembled from the change folder's artifacts plus a structured
task ledger, and its output SHALL be changes to those artifacts. No pipeline stage may depend on
conversation history from an earlier stage or from an owner conversation. A role declared
answer-only is the exception to artifact output: it receives the task artifacts, ledger, its own
conversation context, and the current owner message, then produces an assistant message and
optional structured action proposals. An answer-only role MUST NOT modify artifacts, product
code, task state, gates, or decisions; its run SHALL still end with a structured result. A
confirmed intervention may reach a later pipeline stage only through the ledger rendered by the
orchestrator, never by injecting the conversation transcript. Guidance confirmed for a node SHALL
remain pending until a run that received it is accepted: a run that ends any other way — failed,
interrupted, or found orphaned — MUST NOT consume it, and the next attempt at that node SHALL
receive it again. Guidance MUST NOT be silently dropped by the retry of the run it was written
for.

#### Scenario: AC-104 — Stage prompt assembly

- **WHEN** a pipeline stage is prepared for execution
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

#### Scenario: AC-129 — Guidance survives the attempt it was written for

- **WHEN** a run that received confirmed guidance fails and the node is attempted again
- **THEN** the replacement attempt's ledger SHALL contain that guidance, and it SHALL stop being pending only once a run carrying it is accepted
