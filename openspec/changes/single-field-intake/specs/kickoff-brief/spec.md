## MODIFIED Requirements

### Requirement: REQ-1306 — Planning declares the shape of the work

Planning SHALL declare, as structured data carried out of the stage's result, what the work is
and how much process it needs: a title naming the task, a type drawn from the catalog, a size
drawn from a closed set, and a list of prerequisite tasks — each with a stable key, a title, and
why it is needed — which MAY be empty and SHALL be empty when the task itself was created from
another task's plan at the configured depth cap. The declared title and type SHALL replace the
ones intake derived before the repository had been read, and the replacement SHALL be recorded in
the event log so a client watching the task sees the rename. The task's slug MUST NOT change with
them: it names the branch and the change folder that exist from the first planning run. The
declaration SHALL be required from a planning stage that completed its work, and a stage result
lacking any part of it SHALL fail the attempt exactly as a missing coverage classification does.
No part of the system SHALL derive the title, the type, the size, or the prerequisites by reading
the brief's prose.

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

#### Scenario: AC-1320 — The task is renamed, not moved

- **WHEN** planning declares a title differing from the one intake derived
- **THEN** the task SHALL be readable under the declared title and type, taken from the stage's structured result, the rename SHALL appear in the event log, and the task's slug, branch and change folder SHALL be unchanged

#### Scenario: AC-1321 — A declaration missing its title

- **WHEN** a planning stage returns a completed result whose plan declaration carries a size but no title
- **THEN** the attempt SHALL fail naming the missing part, and the task SHALL keep the title intake derived
