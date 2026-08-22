## ADDED Requirements

### Requirement: REQ-1306 — Planning declares the shape of the work

Planning SHALL declare, as structured data carried out of the stage's result, how much process
the work needs and what must land before it: a size drawn from a closed set, and a list of
prerequisite tasks — each with a stable key, a title, and why it is needed — which MAY be empty
and SHALL be empty when the task itself was created from another task's plan at the configured
depth cap. The declaration SHALL be required from a planning stage that completed its work, and a
stage result lacking it SHALL fail the attempt exactly as a missing coverage classification does.
No part of the system SHALL derive the size or the prerequisites by reading the brief's prose.

#### Scenario: AC-1316 — Size and prerequisites recorded as data

- **WHEN** a planning stage completes its work
- **THEN** its declared size SHALL be recorded on the task from the stage's structured result, and no part of the system SHALL read it out of the brief

#### Scenario: AC-1317 — Planning completes without declaring a plan

- **WHEN** a planning stage returns a completed result carrying no plan declaration
- **THEN** the attempt SHALL fail naming what is missing, and the task SHALL NOT reach its gate

#### Scenario: AC-1318 — Nothing needs to land first

- **WHEN** planning judges that the work needs no prerequisite task
- **THEN** an empty prerequisite list SHALL be a complete declaration and no decision SHALL be raised about it

#### Scenario: AC-1319 — Planning inside a chain

- **WHEN** planning runs on a task created from another task's plan at the configured depth cap
- **THEN** the state it receives SHALL name its depth and that cap, and any prerequisites it declares anyway SHALL NOT become tasks

## MODIFIED Requirements

### Requirement: REQ-1302 — The brief is one page the owner can act on

The kickoff brief stage SHALL leave the change folder's proposal as a brief carrying all of:
what will be done and why, the approach in a handful of bullets, a block of key points naming
risks, blast radius, anything irreversible, and notable trade-offs, the open questions or an
explicit statement that there are none, and the size declared by REQ-1306 with the iteration
budget that size expects. The brief's stated size SHALL be the declared size rather than a second
judgement of it. It SHALL stay within a configured length ceiling and above implementation
detail — this is the alignment step before research, not its result.

#### Scenario: AC-1303 — Every part present

- **WHEN** a brief reaches the kickoff gate
- **THEN** it SHALL carry what and why, the approach, the key points, the questions or their explicit absence, and the size with the expected iterations

#### Scenario: AC-1304 — No questions is stated, not implied

- **WHEN** the brief stage has no question to ask
- **THEN** the brief SHALL say so explicitly rather than omit the section

#### Scenario: AC-1305 — The brief stays a page

- **WHEN** a brief is produced for a large task
- **THEN** it SHALL stay within the configured ceiling, deferring detail to research rather than growing to hold it
