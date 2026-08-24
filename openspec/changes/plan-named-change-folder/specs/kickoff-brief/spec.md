## MODIFIED Requirements

### Requirement: REQ-1306 — Planning declares the shape of the work

Planning SHALL declare, as structured data carried out of the stage's result, how much process
the work needs and what must land before it: a size drawn from a closed set, and a list of
prerequisite tasks — each with a stable key, a title, and why it is needed — which MAY be empty
and SHALL be empty when the task itself was created from another task's plan at the configured
depth cap. The declaration SHALL be required from a planning stage that completed its work, and a
stage result lacking it SHALL fail the attempt exactly as a missing coverage classification does.
No part of the system SHALL derive the size or the prerequisites by reading the brief's prose.

The declaration MAY additionally carry the name of the change being proposed, in the shape the
repository's own change folders take. It is optional: a plan omitting it SHALL be complete, and
the name SHALL then be derived from the title the same declaration carries. A declared name that
is not in that shape SHALL fail the attempt naming the field, rather than being silently
corrected into one.

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

#### Scenario: AC-1323 — Planning names the change

- **WHEN** a planning stage's declaration carries a name for the change
- **THEN** that name SHALL be recorded on the task alongside the rest of the declaration

#### Scenario: AC-1324 — Planning declares no name

- **WHEN** a planning stage's declaration carries no name for the change
- **THEN** the declaration SHALL be complete and the name SHALL be derived from the title it declared

#### Scenario: AC-1325 — A name that is not a change folder's name

- **WHEN** a planning stage declares a change name outside the shape a change folder takes
- **THEN** the attempt SHALL fail naming that field rather than the name being corrected into shape
