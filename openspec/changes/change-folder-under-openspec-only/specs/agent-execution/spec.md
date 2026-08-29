## MODIFIED Requirements

### Requirement: REQ-208 — A role may not exceed its declared write scope

After a run, the files it changed SHALL be checked against the role's contract. A role that is
not permitted to modify product code and has modified files outside the change folder SHALL fail
the stage, and its output MUST NOT be committed.

What the run wrote into the change folder SHALL be part of what the check reads, whether or not the
repository carries that folder. A folder excluded from commits is still the role's output, and a
check that reads only what the repository reports as changed would see nothing at all from a run
that wrote only artifacts — and pass it for that reason.

For a role whose contract is to declare what the change is called, the change folder named by its
own result SHALL be in scope alongside the folder the workspace currently carries. Writing an
artifact under the name the folder is about to take MUST NOT be treated as modifying product
code. No other path outside the change folder is admitted by this.

That admission holds only while the folder can still take the declared name: once the task has
converged on a change folder, a name declared afterwards SHALL NOT be admitted. Nor SHALL a name
the repository already keeps a change under, which is not this task's folder to write into.

#### Scenario: AC-217 — A spec-writing role edits product code

- **WHEN** a run for a role that may not modify product code leaves changes outside the change folder
- **THEN** the stage SHALL fail and no commit SHALL be made

#### Scenario: AC-218 — An implementing role edits product code

- **WHEN** a run for a role permitted to modify product code leaves changes outside the change folder
- **THEN** the stage SHALL be accepted

#### Scenario: AC-243 — A declaring role writes under the name it declared

- **WHEN** a run for a role that declares the change's name writes its artifacts under that declared name rather than under the folder the workspace currently carries
- **THEN** the stage SHALL be accepted, and a path under neither name SHALL still fail it

#### Scenario: AC-250 — A declared name that is not the task's to write into

- **WHEN** a run for a role that declares the change's name writes under a name the repository already keeps a change under, or declares a name after its task has converged on a change folder
- **THEN** the stage SHALL fail as having written outside its scope

#### Scenario: AC-256 — A change folder the repository does not carry

- **WHEN** a run for a role that may not modify product code writes into a change folder excluded from commits
- **THEN** those writes SHALL be read as inside its scope, and a file the same run changed outside that folder SHALL still fail the stage
