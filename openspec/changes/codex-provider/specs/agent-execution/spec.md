## RENAMED Requirements

- FROM: `### Requirement: REQ-213 — A stage's model and reasoning effort are sourced from the task's resolved bindings`
- TO: `### Requirement: REQ-213 — A stage's provider, model and reasoning effort are sourced from the task's resolved bindings`

## MODIFIED Requirements

### Requirement: REQ-213 — A stage's provider, model and reasoning effort are sourced from the task's resolved bindings

A stage job SHALL carry the provider, the model and the reasoning effort recorded on its task's
resolved bindings for that stage's role, and the runner SHALL dispatch that provider's CLI with that
model and that reasoning effort. Process-level configuration SHALL supply a provider, a model or a
reasoning effort only as the seed used when resolving a default that has no other source yet — it
MUST NOT override a value already resolved and stored on a task.

The bound provider governs unless the definition binds the node to a checking provider, in which case
REQ-106 decides the provider and REQ-112 decides the model that follows it. Every other stage runs
its task's binding as stored.

#### Scenario: AC-230 — Two roles on one task run different models and reasoning efforts

- **WHEN** a task's resolved bindings assign different models, or different reasoning efforts, to two of its roles
- **THEN** each role's stage SHALL dispatch with its own assigned model and reasoning effort, not a single shared value

#### Scenario: AC-231 — Process configuration does not override a resolved binding

- **WHEN** a stage dispatches for a task whose resolved bindings already name a model and reasoning effort for its role, and the process-level defaults differ
- **THEN** the dispatched job SHALL run the model and reasoning effort recorded on the task, not the process-level default

#### Scenario: AC-240 — Two roles on one task run different providers

- **WHEN** a task's resolved bindings assign different providers to two of its roles and both stages run
- **THEN** each stage SHALL dispatch the CLI of its own bound provider, and the provider it ran under SHALL be recorded against that stage

## ADDED Requirements

### Requirement: REQ-215 — A stage runs under exactly the provider it was bound to

The system SHALL be able to hold every configured provider at once, and a stage SHALL be executed by
the provider its job names. A stage MUST NOT be executed by a different provider than the one
recorded against it: the binding is what the stage row and the commit trail attribute the work to,
and running another provider would make that attribution false.

A job naming a provider the deployment does not run SHALL fail the stage with a provider failure
naming the provider, rather than being served by whichever provider is at hand. The failure is a
configuration fault and SHALL be reported as one.

#### Scenario: AC-241 — Two providers configured

- **WHEN** two stages of one task are dispatched under different configured providers
- **THEN** each SHALL be executed by the provider named on its job, and neither SHALL be substituted for the other

#### Scenario: AC-242 — A provider the deployment does not run

- **WHEN** a stage is dispatched naming a provider the deployment has not configured
- **THEN** the stage SHALL fail with a provider failure naming that provider, and no agent SHALL be invoked
