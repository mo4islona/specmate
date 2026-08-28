## MODIFIED Requirements

### Requirement: REQ-208 — A role may not exceed its declared write scope

After a run, the files it changed SHALL be checked against the role's contract. A role that is
not permitted to modify product code and has modified files outside the change folder SHALL fail
the stage, and its output MUST NOT be committed.

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
attempt's own session. Where that session cannot be continued, the retry SHALL fall back to the
resumption the stage declares before starting cold, and whichever grounding could not be had
SHALL be recorded, as it is for any resumption that could not be had.

A retry that continues a declined attempt's session SHALL be told that the working tree was
discarded. The session it continues records writing artifacts the discard has since removed, and
an attempt that believes them present writes only its correction.

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

#### Scenario: AC-251 — A refused session on a resuming stage

- **WHEN** a retry that would continue a declined attempt's session is refused that session, and its stage declares a resumption of another node
- **THEN** the retry SHALL continue the resumed node's session rather than starting cold, and the refusal SHALL be recorded

#### Scenario: AC-252 — The retry is told the tree was discarded

- **WHEN** a retry continues a declined attempt's session after that attempt's uncommitted work was discarded
- **THEN** it SHALL be told that the working tree was taken back to the last committed state

## ADDED Requirements

### Requirement: REQ-216 — A run that never started is not a provider failure

Where the execution backend could not start the run at all, the stage SHALL record that as a
failure of the backend, distinct from a provider that ran and produced nothing. The recorded
detail SHALL carry what the backend reported. A provider's exit status MUST NOT be attributed to
a provider that was never executed.

The converse SHALL hold as well: where the run did start, its exit status is the provider's and
MUST NOT be attributed to the backend, whatever that status happens to be. An exit code the
backend also uses to report its own failures is not evidence that the run never started.

#### Scenario: AC-246 — The container could not be started

- **WHEN** the backend cannot start a stage's execution
- **THEN** the stage's recorded failure SHALL name the backend as the cause and its detail SHALL carry what the backend reported

#### Scenario: AC-247 — The provider ran and produced nothing

- **WHEN** a provider executes and exits without leaving a result
- **THEN** the stage's recorded failure SHALL name the provider, distinctly from a backend that could not start

#### Scenario: AC-253 — A started run exits with a status the backend also uses

- **WHEN** a run that did start exits with a status the backend also reports its own start failures with
- **THEN** the stage's recorded failure SHALL name the provider rather than the backend

### Requirement: REQ-217 — A retry is told why its predecessor was rejected

Where a stage is attempted again after a failed or declined attempt, the new attempt SHALL be
given what that attempt failed or was declined for, in the same terms the failure was recorded
in. This SHALL hold whether or not the new attempt continues a session, and whether the attempt
is made by the runner itself or dispatched afresh. A first attempt SHALL receive no such
statement, and neither SHALL a run that is not an attempt at that stage.

The statement SHALL ask for a correction only where the previous attempt produced a result to
correct. Where the run itself was what went wrong there is nothing to correct, and only reasons
the failure vocabulary carries SHALL be stated at all.

#### Scenario: AC-248 — The rejection reaches the next attempt

- **WHEN** an attempt is dispatched after a previous attempt of the same stage failed or was declined
- **THEN** the prompt it receives SHALL state what that previous attempt failed or was declined for

#### Scenario: AC-249 — A first attempt

- **WHEN** the first attempt of a stage is dispatched
- **THEN** the prompt it receives SHALL state no previous rejection

#### Scenario: AC-254 — A run that is not an attempt at the stage

- **WHEN** a conversational turn runs for a task whose current node has a failed attempt on record
- **THEN** it SHALL NOT be told that a previous attempt was rejected

#### Scenario: AC-255 — Nothing to correct

- **WHEN** an attempt is dispatched after a previous attempt whose own run failed rather than produced a result
- **THEN** the statement it receives SHALL NOT present that failure as a correction to make
