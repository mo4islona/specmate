## MODIFIED Requirements

### Requirement: REQ-208 — A role may not exceed its declared write scope

After a run, the files it changed SHALL be checked against the role's contract. A role that is
not permitted to modify product code and has modified files outside the change folder SHALL fail
the stage, and its output MUST NOT be committed.

For a role whose contract is to declare what the change is called, the change folder named by its
own result SHALL be in scope alongside the folder the workspace currently carries. Writing an
artifact under the name the folder is about to take MUST NOT be treated as modifying product
code. No other path outside the change folder is admitted by this.

#### Scenario: AC-217 — A spec-writing role edits product code

- **WHEN** a run for a role that may not modify product code leaves changes outside the change folder
- **THEN** the stage SHALL fail and no commit SHALL be made

#### Scenario: AC-218 — An implementing role edits product code

- **WHEN** a run for a role permitted to modify product code leaves changes outside the change folder
- **THEN** the stage SHALL be accepted

#### Scenario: AC-243 — A declaring role writes under the name it declared

- **WHEN** a run for a role that declares the change's name writes its artifacts under that declared name rather than under the folder the workspace currently carries
- **THEN** the stage SHALL be accepted, and a path under neither name SHALL still fail it

### Requirement: REQ-209 — A retry starts from committed state

Before a failed stage is attempted again, the uncommitted changes its previous attempt left SHALL
be discarded, so the new attempt reads the artifacts as they were last committed rather than as a
failed attempt half-rewrote them.

A retry SHALL likewise not inherit the conversation of an attempt whose own run failed. Where the
stage declares a resumption, the new attempt SHALL continue the resumed node's session as that
node left it, without the turns the failed attempt appended; where it declares none, the new
attempt SHALL start cold. A retry reading its own failed reasoning is the case the discard exists
to prevent, and a session carries that reasoning as surely as a half-written file does.

An attempt whose run completed and produced a result that the harness then declined for a named,
checkable defect is not such a failure. A retry after one of those MAY continue the declined
attempt's own session. Where that session cannot be continued, the retry SHALL start cold and the
reason SHALL be recorded, as it is for any resumption that could not be had.

#### Scenario: AC-219 — Retry after a failed attempt

- **WHEN** a stage is retried after an attempt that modified artifacts and then failed
- **THEN** the new attempt SHALL run against the artifacts as of the last stage commit

#### Scenario: AC-236 — Retry of a resuming stage

- **WHEN** a stage declaring a resumption is retried after a failed attempt
- **THEN** the new attempt SHALL continue the resumed node's session as that node left it, carrying none of the failed attempt's turns

#### Scenario: AC-244 — Retry after a declined result

- **WHEN** a stage is retried after an attempt whose run completed and whose result the harness declined for a named defect
- **THEN** the new attempt MAY continue that attempt's own session

#### Scenario: AC-245 — Retry after the run itself failed

- **WHEN** a stage is retried after an attempt that timed out, produced no result, produced an unparseable result, reported its own failure, or could not be started
- **THEN** the new attempt SHALL NOT continue that attempt's session

## ADDED Requirements

### Requirement: REQ-216 — A run that never started is not a provider failure

Where the execution backend could not start the run at all, the stage SHALL record that as a
failure of the backend, distinct from a provider that ran and produced nothing. The recorded
detail SHALL carry what the backend reported. A provider's exit status MUST NOT be attributed to
a provider that was never executed.

#### Scenario: AC-246 — The container could not be started

- **WHEN** the backend cannot start a stage's execution
- **THEN** the stage's recorded failure SHALL name the backend as the cause and its detail SHALL carry what the backend reported

#### Scenario: AC-247 — The provider ran and produced nothing

- **WHEN** a provider executes and exits without leaving a result
- **THEN** the stage's recorded failure SHALL name the provider, distinctly from a backend that could not start

### Requirement: REQ-217 — A retry is told why its predecessor was rejected

Where a stage is attempted again after a failed or declined attempt, the new attempt SHALL be
given what that attempt failed or was declined for, in the same terms the failure was recorded
in. This SHALL hold whether or not the new attempt continues a session. A first attempt SHALL
receive no such statement.

#### Scenario: AC-248 — The rejection reaches the next attempt

- **WHEN** an attempt is dispatched after a previous attempt of the same stage failed or was declined
- **THEN** the prompt it receives SHALL state what that previous attempt failed or was declined for

#### Scenario: AC-249 — A first attempt

- **WHEN** the first attempt of a stage is dispatched
- **THEN** the prompt it receives SHALL state no previous rejection
