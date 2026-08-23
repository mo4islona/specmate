## ADDED Requirements

### Requirement: REQ-214 — A provider session outlives the run that opened it

A run's provider session SHALL be identified and recorded as durable state on the stage that
opened it, so a later stage can continue it. The identifier SHALL be recorded whether or not any
node declares a resumption: a session that turns out to be unresumable is a fact worth having, and
recording it costs one field.

Where a node declares that it resumes an earlier node's session, its run SHALL continue that
session as the resumed node left it. Continuation SHALL survive an orchestrator restart between
the two nodes and SHALL NOT require any process to have stayed running.

Where the session cannot be continued — it was never recorded, the provider no longer has it, or
the provider does not support continuation — the stage SHALL run cold from its artifacts and
ledger, and SHALL record that it did so and why. A stage MUST NOT fail merely because a session
could not be continued: the artifacts are the contract and the session is an optimisation of
grounding, so a cold run is a degraded run and never a broken one.

#### Scenario: AC-232 — The session identifier is recorded

- **WHEN** a stage's run completes
- **THEN** the provider session it ran under SHALL be recorded on that stage

#### Scenario: AC-233 — A declared resumption continues the session

- **WHEN** a stage declaring resumption of an earlier node is dispatched and that node's session is available
- **THEN** the run SHALL continue that session rather than opening a new one

#### Scenario: AC-234 — Restart between the two nodes

- **WHEN** the orchestrator restarts while a task waits at a gate between a node and the node resuming it
- **THEN** the resumption SHALL still occur after the gate is answered

#### Scenario: AC-235 — The session cannot be continued

- **WHEN** a stage declaring resumption is dispatched and the session is unavailable
- **THEN** the stage SHALL run from its artifacts and ledger, SHALL be accepted on its own terms, and SHALL record that it ran cold together with the reason

## MODIFIED Requirements

### Requirement: REQ-209 — A retry starts from committed state

Before a failed stage is attempted again, the uncommitted changes its previous attempt left SHALL
be discarded, so the new attempt reads the artifacts as they were last committed rather than as a
failed attempt half-rewrote them.

A retry SHALL likewise not inherit the conversation its own failed attempt produced. Where the
stage declares a resumption, the new attempt SHALL continue the resumed node's session as that
node left it, without the turns the failed attempt appended; where it declares none, the new
attempt SHALL start cold. A retry reading its own failed reasoning is the case the discard exists
to prevent, and a session carries that reasoning as surely as a half-written file does.

#### Scenario: AC-219 — Retry after a failed attempt

- **WHEN** a stage is retried after an attempt that modified artifacts and then failed
- **THEN** the new attempt SHALL run against the artifacts as of the last stage commit

#### Scenario: AC-236 — Retry of a resuming stage

- **WHEN** a stage declaring a resumption is retried after a failed attempt
- **THEN** the new attempt SHALL continue the resumed node's session as that node left it, carrying none of the failed attempt's turns
