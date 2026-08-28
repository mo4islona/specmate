# agent-execution Specification

## Purpose
Defines how one stage of a task is actually executed: the prompt the agent is given, the
isolation and the limits it runs under, what is done with what it produces, and how a provider's
authentication is checked before work is handed to it. This is the boundary between an
orchestrator that decides what should happen and an agent that makes it happen.

## Requirements

### Requirement: REQ-201 — A prompt is assembled from the role's declared inputs

A stage's prompt SHALL be assembled from four sources and no others: the prompt file named by the
role's contract, the artifacts the contract declares the role reads, a rendered task ledger, and
the diff of product code changed on the task branch so far. Artifacts the role does not declare
MUST NOT be included. When the role's prompt file is absent, the stage SHALL fail with a message
naming the role and the expected file rather than running with an incomplete prompt.

#### Scenario: AC-201 — Undeclared artifacts are withheld

- **WHEN** a stage is prepared for a role whose contract does not list an artifact kind that exists in the change folder
- **THEN** the assembled prompt SHALL NOT contain that artifact

#### Scenario: AC-202 — A reviewing role sees the code

- **WHEN** a stage is prepared for a role that may not modify product code, after an earlier stage changed product code
- **THEN** the prompt SHALL carry the diff of those changes, so the role can review what was written and not only what was claimed

#### Scenario: AC-203 — Role prompt file missing

- **WHEN** a stage is prepared for a role whose prompt file does not exist
- **THEN** the stage SHALL fail with a message naming the role and the expected file, and no agent SHALL be invoked

#### Scenario: AC-204 — First stage of a task

- **WHEN** a stage is prepared and the change folder holds no artifacts and the task branch no code changes
- **THEN** the prompt SHALL still be assembled, from the role prompt and the ledger, and the stage SHALL run

### Requirement: REQ-202 — The ledger is the only state a stage receives that is not a file

A stage SHALL receive a rendered ledger describing what the task is — including the request the
owner launched it with, in their own words — which loop and round it is in, the findings of the
previous review round, and the comments the owner left when acting at a gate. The ledger MUST
NOT contain the transcript of any earlier stage, and no conversational state between agents may
reach the agent; the owner's own words are task state, not a transcript.

#### Scenario: AC-205 — Second round of a review loop

- **WHEN** a stage is prepared for a task whose previous round produced reviewer findings
- **THEN** the ledger SHALL carry those findings

#### Scenario: AC-206 — No transcript is carried

- **WHEN** a stage is prepared for a task that has already run other stages
- **THEN** the prompt SHALL contain no output of those stages other than the artifacts they committed and the ledger

#### Scenario: AC-224 — The owner's request travels with the task

- **WHEN** a stage is prepared for a task launched with a written request
- **THEN** the ledger SHALL carry that request as the owner wrote it

#### Scenario: AC-225 — A gate comment reaches the next run

- **WHEN** a stage is prepared after the owner redirected or reworked the task with a comment
- **THEN** the ledger SHALL carry that comment

### Requirement: REQ-203 — A stage is isolated from service credentials and from other tasks

The environment a stage runs in SHALL expose the working tree of its own task and the provider's
stored authentication, and nothing else. Database credentials, the target-repository key, and any
other task's working tree MUST NOT be reachable from a running stage.

#### Scenario: AC-207 — Another task's workspace

- **WHEN** a stage runs while other tasks have provisioned workspaces
- **THEN** those workspaces SHALL NOT be readable from within the stage

#### Scenario: AC-208 — Service credentials

- **WHEN** a stage runs
- **THEN** the database credential and the target-repository key SHALL NOT be present in its environment or its filesystem

### Requirement: REQ-204 — Every run is bounded in time and resources

A stage SHALL run under a wall-clock deadline and under CPU and memory ceilings. Exceeding the
deadline SHALL terminate the run and fail the stage with an outcome distinguishable from a run
that failed on its own. Resource exhaustion inside a stage MUST NOT stop the long-lived services.

#### Scenario: AC-209 — Run exceeds its deadline

- **WHEN** a stage has not finished by its deadline
- **THEN** the run SHALL be terminated and the stage SHALL fail, reported as timed out rather than as a provider failure

#### Scenario: AC-210 — A stage exhausts its memory ceiling

- **WHEN** a stage allocates beyond its memory ceiling
- **THEN** only that stage SHALL be terminated, and the orchestrator SHALL continue running

### Requirement: REQ-205 — The execution environment is selectable and does not change behavior

The system SHALL support executing a stage either isolated from the services or in-process for
development. The assembled prompt, the parsed result, the captured log, and the reported exit
status SHALL NOT differ between them. When the process runs in production and is configured to
execute stages in-process, it SHALL refuse to start rather than run agents without isolation.

#### Scenario: AC-211 — The same stage in either environment

- **WHEN** one stage job is executed isolated and then in-process against the same workspace state
- **THEN** the assembled prompt SHALL be identical and the result SHALL be parsed the same way

#### Scenario: AC-212 — In-process execution configured in production

- **WHEN** a process starts in production configured to execute stages in-process
- **THEN** it SHALL exit with a non-zero status and an error naming the offending setting

### Requirement: REQ-206 — Every run is recorded

A run's provider output SHALL be captured to the stage's log location in the workspace, and the
run SHALL report its exit status, its duration, and whatever usage the provider disclosed. The
log of a failed run MUST be retained, because a failure is what a human will be asked about.

#### Scenario: AC-213 — Failed run

- **WHEN** a stage fails
- **THEN** its captured output SHALL be retained and reachable for that stage

#### Scenario: AC-214 — Usage reported by the provider

- **WHEN** a provider reports token counts or cost for a run
- **THEN** those figures SHALL be returned with the stage's outcome

### Requirement: REQ-207 — A stage's result is the one its own attempt produced

A run's structured result SHALL be read from a fixed location in the working tree after the run
completes. A result left behind by an earlier attempt MUST NOT be accepted as the current
attempt's, and the absence of a result from this attempt MUST be reported as absent.

#### Scenario: AC-215 — Stale result from an earlier attempt

- **WHEN** an attempt finishes without writing a result and a previous attempt's result is still present
- **THEN** the stage SHALL be treated as having produced no result

#### Scenario: AC-216 — Result produced by this attempt

- **WHEN** an attempt writes a valid result
- **THEN** that result SHALL be parsed and returned as the stage's outcome

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

### Requirement: REQ-210 — Provider authentication is checkable without running a stage

A provider SHALL report whether its stored authentication is usable, distinguishing usable from
expired from indeterminate, without executing a stage. The report MUST NOT disclose credential
material.

#### Scenario: AC-220 — Expired session

- **WHEN** a provider's stored session is no longer accepted
- **THEN** its report SHALL say so, so that dependent tasks can be paused rather than failed

#### Scenario: AC-221 — Report contents

- **WHEN** a provider reports its authentication state
- **THEN** the report SHALL contain no token, key, or session material

### Requirement: REQ-211 — Access to a container runtime is opt-in per stage

A stage SHALL carry a declaration of whether its role needs to start containers of its own, for
example to run a repository's own test harness. The declaration SHALL default to off, and a stage
that has not declared it MUST NOT be able to reach a container runtime.

#### Scenario: AC-222 — Stage that has not declared the need

- **WHEN** a stage without the declaration runs on a host that has a container runtime
- **THEN** that runtime SHALL NOT be reachable from the stage

#### Scenario: AC-223 — Declaration travels with the stage

- **WHEN** a stage job is prepared
- **THEN** its need for a container runtime SHALL be part of the job, so the executor can act on it without inspecting the role

### Requirement: REQ-212 — A running stage emits structured activity as it proceeds

While a stage attempt is running, the executor SHALL parse the provider CLI's structured
streaming output and append a durable activity event for each recognized tool use, naming the
tool and its target. An activity event MUST be attributable to the specific stage attempt that
produced it and MUST NOT be presented as part of that attempt's accepted result. Provider CLI
output that is not a recognized structured tool-use entry MUST NOT be forwarded as an activity
event — this requirement covers summarized, recognized actions, not a relay of raw output. When
a provider's CLI does not support structured streaming output, the stage SHALL run to completion
without activity events rather than fail.

#### Scenario: AC-226 — Editing a file mid-run

- **WHEN** a running attempt's provider CLI reports a file-editing tool use
- **THEN** an activity event naming that tool and the file path SHALL be appended to the event log, attributed to the running attempt

#### Scenario: AC-227 — Unrecognized CLI output

- **WHEN** the provider CLI emits output that is not a recognized structured tool-use entry
- **THEN** no activity event SHALL be produced for it

#### Scenario: AC-228 — Provider without structured streaming

- **WHEN** a stage runs under a provider whose CLI does not support structured streaming output
- **THEN** the stage SHALL run to completion without activity events rather than fail

#### Scenario: AC-229 — A retried attempt gets its own activity

- **WHEN** a stage is retried after a failed attempt that had produced activity events
- **THEN** the new attempt's activity events SHALL be attributed to it, distinguishable from the discarded attempt's

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
