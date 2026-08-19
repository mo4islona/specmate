## ADDED Requirements

### Requirement: REQ-213 — A stage's model and reasoning effort are sourced from the task's resolved bindings

A stage job SHALL carry the model and reasoning effort recorded on its task's resolved bindings
for that stage's role, and the runner SHALL dispatch the provider CLI with that model and that
reasoning effort. Process-level configuration SHALL supply a model or reasoning effort only as
the seed used when resolving a default that has no other source yet — it MUST NOT override a
value already resolved and stored on a task.

#### Scenario: AC-230 — Two roles on one task run different models and reasoning efforts

- **WHEN** a task's resolved bindings assign different models, or different reasoning efforts, to two of its roles
- **THEN** each role's stage SHALL dispatch with its own assigned model and reasoning effort, not a single shared value

#### Scenario: AC-231 — Process configuration does not override a resolved binding

- **WHEN** a stage dispatches for a task whose resolved bindings already name a model and reasoning effort for its role, and the process-level defaults differ
- **THEN** the dispatched job SHALL run the model and reasoning effort recorded on the task, not the process-level default
