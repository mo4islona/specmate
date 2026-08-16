## MODIFIED Requirements

### Requirement: Every role consumes and produces OpenSpec artifacts

A role's input SHALL be assembled from the change folder's artifacts plus a structured task
ledger, and its output SHALL be changes to those artifacts — except for a role declared
answer-only. An answer-only role additionally receives a question, produces a structured
answer instead of artifact changes, and MUST NOT modify artifacts, product code, or task
state; its run still ends with the structured result like any other. No stage or run may
depend on conversation history from an earlier stage or run.

#### Scenario: Stage prompt assembly

- **WHEN** a stage is prepared for execution
- **THEN** its prompt SHALL contain the role prompt, the current artifacts, and the ledger — and nothing carried over from a previous stage's transcript

#### Scenario: Rework after a summary

- **WHEN** a task is sent back for rework
- **THEN** the affected stages SHALL be re-run with context rebuilt from the updated artifacts, not from accumulated history

#### Scenario: Answer-only run leaves no trace

- **WHEN** an answer-only role's run completes
- **THEN** it SHALL have produced a structured answer and a structured result, and the change folder's artifacts SHALL be unchanged
