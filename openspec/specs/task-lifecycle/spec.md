# task-lifecycle Specification

## Purpose
Defines the states a task moves through from draft to archive, which transitions are legal,
where the human must be asked, and what stops the research↔review loop from running forever.
The orchestrator owns these transitions; agents never set state.

## Requirements

### Requirement: REQ-601 — Task states and legal transitions

The system SHALL derive a task's legal transitions from its pinned pipeline — its forward
edges, loop edges, and gate resolutions — together with the type-independent interrupt states,
which MAY be entered from any active state and SHALL return the task to the state they
interrupted. A transition outside that derived set MUST be rejected. State SHALL be changed only
by the orchestrator, never by an agent's output.

#### Scenario: AC-601 — Illegal transition attempted

- **WHEN** a transition not derivable from the task's pinned pipeline or the interrupt rules is attempted
- **THEN** it SHALL be rejected and the task SHALL remain in its current state

#### Scenario: AC-602 — Agent result implies a state

- **WHEN** an agent's result suggests the task should advance
- **THEN** the orchestrator SHALL decide the transition; the agent's output alone SHALL NOT change state

#### Scenario: AC-603 — Two tasks with different pipelines

- **WHEN** two tasks pinned to different pipeline definitions are inspected
- **THEN** each SHALL accept only the transitions its own pinned graph derives, under one and the same engine

### Requirement: REQ-602 — The happy path reaches archive

There SHALL be a legal path from a drafted task through planning, specification, implementation,
validation, summarisation, and publication to archive, passing every mandatory human gate. That
spine SHALL be present in every profile a task may run. Review of the specification is the one
stage outside the spine: it SHALL be present in the full profile and MAY be absent from a reduced
one or skipped by its own condition. No profile MAY omit a stage of the spine, a human gate, or
the validation of the code that ships.

Planning SHALL be one stage, not two. Specification SHALL be the continuation of that same stage's
work after the kickoff gate, not a fresh reading of the repository by a second role.

#### Scenario: AC-604 — Nothing needs revision

- **WHEN** every review approves and every gate is approved
- **THEN** the task SHALL be able to walk from draft to archived using only legal transitions

#### Scenario: AC-639 — The reduced profile still reaches archive

- **WHEN** a task runs a reduced profile and every gate is approved
- **THEN** it SHALL walk from planning to archived through the spine and all three human gates, using only legal transitions

#### Scenario: AC-640 — Validation is never optional

- **WHEN** any shipped profile is inspected
- **THEN** it SHALL contain the validating stage, and no profile SHALL reach publication without it

### Requirement: REQ-603 — Review loops go backwards, never forwards

A review that requests changes SHALL return the task to the stage that produces the artifacts
under review. A review MUST NOT be able to skip the stages between itself and publication.

#### Scenario: AC-605 — Spec review requests changes

- **WHEN** spec review returns a revise verdict
- **THEN** the task SHALL return to research

#### Scenario: AC-606 — Code review requests changes

- **WHEN** code review returns a revise verdict
- **THEN** the task SHALL return to implementation

#### Scenario: AC-607 — Code review cannot publish

- **WHEN** a transition directly from code review to publication is attempted
- **THEN** it SHALL be rejected

### Requirement: REQ-604 — Three mandatory human gates

The system SHALL require explicit human approval at exactly three points: the kickoff brief
before research begins, the specification before code is written, and the final summary before
publication. All other transitions MAY proceed without the human.

#### Scenario: AC-608 — Gate inventory

- **WHEN** the states are inspected
- **THEN** exactly the kickoff, specification, and final states SHALL be marked as human gates

#### Scenario: AC-609 — Research before approval

- **WHEN** a task's kickoff brief has not been approved
- **THEN** research SHALL NOT begin

### Requirement: REQ-605 — Kickoff redirect is bounded

At the kickoff gate the human SHALL be able to approve, redirect with a comment, or cancel. A
redirect SHALL return the task to planning to regenerate the brief, and the number of
regenerations SHALL be capped.

#### Scenario: AC-610 — Redirect at kickoff

- **WHEN** the human redirects a kickoff brief
- **THEN** the task SHALL return to planning and the comment SHALL be recorded as feedback

#### Scenario: AC-611 — Redirect cap reached

- **WHEN** the configured number of regenerations has been used
- **THEN** the task SHALL stop regenerating and require a decision from the human

### Requirement: REQ-606 — Loops are bounded by caps

Each review loop SHALL have a maximum number of iterations, stored with the task. The caps a task
runs under SHALL be selected by the size planning declares, and SHALL remain overridable per task.
A task MUST NOT run under caps chosen for a size other than the one it declared: an iteration
budget sized for the largest work is not a bound on the smallest.

Exhausting a cap SHALL escalate to the human rather than continuing to loop or failing silently.

#### Scenario: AC-612 — Iteration cap exhausted

- **WHEN** a loop reaches its configured maximum iterations without approval
- **THEN** the task SHALL await a human decision

#### Scenario: AC-641 — Caps follow the declared size

- **WHEN** planning declares a size and the task has no explicit cap override
- **THEN** the task SHALL run under the caps that size selects, not under the caps it was created with

### Requirement: REQ-607 — Repeated findings escalate

When a reviewer returns the same finding identifier in consecutive rounds up to the configured
threshold, the orchestrator SHALL escalate to the human instead of running another round.

#### Scenario: AC-613 — Reviewer repeats itself

- **WHEN** the same finding identifier is returned in consecutive rounds up to the threshold
- **THEN** the task SHALL await a human decision rather than starting another round

### Requirement: REQ-608 — Budgets pause rather than fail

Each task SHALL carry a cost budget and an agent-minutes budget — the time agents actually
spent running for it, not the time it has existed. Reaching either SHALL pause the task before
the next agent run is started and raise it to the human, and MUST NOT discard work already
done: a run under way when a budget is reached finishes and is recorded. A task paused for
exhaustion SHALL leave that state only by having the exhausted budget raised or by being
cancelled.

#### Scenario: AC-614 — Cost budget exceeded mid-run

- **WHEN** a task's cost budget is exhausted
- **THEN** the task SHALL pause with its artifacts intact and the human SHALL be notified

#### Scenario: AC-630 — A task that waits is not a task that spends

- **WHEN** a task spends hours parked at a gate and is then approved
- **THEN** its budgets SHALL be no closer to exhaustion than before it parked

### Requirement: REQ-609 — Interruptions remember where to resume

A task interrupted to wait for a human, or paused, SHALL record the state it was interrupted in
so it can resume exactly there once resolved.

#### Scenario: AC-615 — Decision answered

- **WHEN** the human answers the decision that blocked a task
- **THEN** the task SHALL resume in the state it was interrupted in

### Requirement: REQ-610 — Terminal states are terminal

An archived or cancelled task SHALL have no outgoing transitions and MUST NOT be pausable,
cancellable, or resumable. A failed task MAY be restarted from an earlier stage, because
failure is recoverable while completion is not.

#### Scenario: AC-616 — Cancelling an archived task

- **WHEN** cancellation is attempted on an archived task
- **THEN** it SHALL be rejected

#### Scenario: AC-617 — Restarting a failed task

- **WHEN** a failed task is restarted
- **THEN** it SHALL be allowed to re-enter an earlier stage

### Requirement: REQ-611 — Rework re-enters at the affected stage

After the final gate the human SHALL be able to send a task back for rework, and the task SHALL
re-enter only the affected stages rather than restarting the pipeline. Iteration counters for
the new round SHALL start again under their own cap.

#### Scenario: AC-618 — Rework touches only code

- **WHEN** the human sends a summarised task back with implementation-level comments
- **THEN** the task SHALL return to implementation rather than to research

### Requirement: REQ-612 — The engine advances a task from stored state alone

After a stage completes, the next transition SHALL be determined solely by the pinned graph,
the recorded outcome, the stored rounds, and the task's caps: success on a non-review stage
advances along the forward edge, an approve verdict advances, a revise verdict records the round
and follows the loop edge when the round fits the cap, and an escalate verdict or an exhausted
cap parks the task awaiting a human. The engine MUST NOT branch on task type, role, or node
identity beyond what the pinned graph declares.

#### Scenario: AC-619 — Revise within the cap

- **WHEN** a review stage returns revise and the loop's used rounds are below its cap
- **THEN** the round SHALL be recorded with its verdict and findings and the task SHALL follow the loop edge

#### Scenario: AC-620 — Revise at the cap

- **WHEN** a review stage returns revise and another round would exceed the loop's cap
- **THEN** the task SHALL park awaiting a human and no further stage SHALL be dispatched

#### Scenario: AC-621 — Approval advances

- **WHEN** a review stage returns approve
- **THEN** the task SHALL move to the pinned graph's forward target of that stage

### Requirement: REQ-613 — Stage failure is retried up to a cap, then fails the task

A stage attempt that fails — timeout, invalid result after the runner's own retry, scope
violation, or crash — SHALL have its uncommitted work discarded and SHALL be re-dispatched with
an incremented attempt number, up to a configured per-stage failure cap. Exhausting the cap SHALL
move the task to failed, recording the stage and final reason. Every failed attempt SHALL be
recorded; failure MUST NOT be silent. An attempt the owner explicitly interrupts under REQ-1607
SHALL instead be recorded as `interrupted` and MUST NOT count towards the failure cap. The task
SHALL remain paused after cleanup; if the owner later restarts it, the new attempt SHALL begin
from committed state with an incremented attempt number.

An attempt that failed for a reason re-running it cannot change SHALL NOT be re-dispatched. It
SHALL be recorded like any other failed attempt and SHALL fail the task immediately, naming the
stage and the reason, rather than spending the cap on repetitions of the same run. Only failures
that are unfixable by construction qualify; a failure that merely looks unlikely to succeed keeps
its retries.

A conversational turn's own attempt cap SHALL read the same property: a turn that failed for a
reason re-running it cannot change SHALL NOT be attempted again, and the owner SHALL be told
without waiting for the cap to be spent on repetitions.

#### Scenario: AC-622 — Retry starts from committed state

- **WHEN** an attempt fails after half-rewriting artifacts and a retry is dispatched
- **THEN** the retry SHALL read the artifacts as last committed, not as the failed attempt left them

#### Scenario: AC-623 — Attempt cap exhausted

- **WHEN** a stage's failure cap is spent without a successful attempt
- **THEN** the task SHALL move to failed and the record SHALL name the stage and the last failure reason

#### Scenario: AC-631 — Owner interruption does not spend the failure cap

- **WHEN** the owner interrupts a running stage and it restarts with confirmed guidance
- **THEN** the interrupted attempt SHALL remain visible and its replacement SHALL start without increasing the consecutive-failure count

#### Scenario: AC-645 — A failure no retry can fix

- **WHEN** an attempt fails because its execution could not be started at all
- **THEN** no further attempt SHALL be dispatched for that stage and the task SHALL fail naming the stage and that reason

#### Scenario: AC-646 — A failure that might not recur

- **WHEN** an attempt fails on a timeout or on a result that did not parse
- **THEN** the stage SHALL still be re-dispatched up to its cap

#### Scenario: AC-647 — A conversational turn no retry can fix

- **WHEN** a conversational turn fails because its execution could not be started at all
- **THEN** no further attempt SHALL be made at that turn and the owner SHALL be told the reason

### Requirement: REQ-614 — A restart recovers every task from the store

After an orchestrator restart, every non-terminal task SHALL resume from persisted state alone.
A stage recorded as running with no live execution behind it SHALL be treated as a failed
attempt: its execution SHALL be terminated if still present, its workspace discarded, and the
stage re-dispatched under the same attempt cap, updating the interrupted attempt's record rather
than duplicating it. A task parked at a gate or awaiting a human SHALL remain parked across the
restart.

#### Scenario: AC-624 — Killed mid-stage

- **WHEN** the orchestrator is killed while a stage runs and is then restarted
- **THEN** the interrupted attempt SHALL be recorded as failed and the stage SHALL run again as the next attempt, and the task SHALL continue from its outcome

#### Scenario: AC-625 — Restart while parked

- **WHEN** the orchestrator restarts while a task waits at a human gate
- **THEN** the task SHALL still be parked at that gate and nothing SHALL be dispatched for it

### Requirement: REQ-615 — A task may wait on another task

A task SHALL be able to wait on the completion of other tasks. While it waits, nothing SHALL be
dispatched for it, and entering that wait SHALL be available from any active state, like the
other interrupts. When the last task it waits on completes successfully, it SHALL be released
into its pipeline's entry, so it runs against the world its blockers left rather than the one it
was blocked in. When a task it waits on is cancelled or fails, the waiting task SHALL be raised
to the human rather than left waiting on something that will never complete.

#### Scenario: AC-626 — Nothing runs while waiting

- **WHEN** a task is waiting on another task
- **THEN** no stage SHALL be dispatched for it, however many times it is polled

#### Scenario: AC-627 — Released when the blocker lands

- **WHEN** the last task a waiting task depends on reaches its terminal successfully
- **THEN** the waiting task SHALL enter its pipeline's entry state

#### Scenario: AC-628 — Still waiting on the others

- **WHEN** one of several blockers completes
- **THEN** the task SHALL keep waiting until the last of them does

#### Scenario: AC-629 — The blocker will never land

- **WHEN** a task a waiting task depends on is cancelled or fails
- **THEN** the waiting task SHALL be raised to the human rather than left waiting

### Requirement: REQ-617 — A task created from a plan records its origin, and chains are bounded

A task created from another task's plan SHALL record the task whose plan created it and how deep
in that chain it sits, so the chain is readable from the task alone. Depth SHALL be bounded by a
configured cap: a task at the cap MUST NOT create further tasks, and the choice to do so MUST NOT
be offered for it. The number of tasks one plan may create SHALL be bounded by a configured cap
of its own, and anything the plan proposed beyond that cap SHALL be named to the owner rather
than silently dropped. A task the owner launched SHALL be at depth zero with no origin.

#### Scenario: AC-635 — The chain is readable from the task

- **WHEN** a task created from another task's plan is inspected
- **THEN** it SHALL name the task whose plan created it and its depth in that chain

#### Scenario: AC-636 — At the depth cap

- **WHEN** a task at the configured depth cap reaches its kickoff gate with a coverage gap or a proposed plan
- **THEN** creating further tasks SHALL NOT be among its options, and the reason SHALL be stated with the choice

#### Scenario: AC-637 — More prerequisites than the cap allows

- **WHEN** a plan proposes more prerequisite tasks than the configured cap allows
- **THEN** at most the cap SHALL be created, and the proposals not created SHALL be named to the owner

#### Scenario: AC-638 — An owner-launched task

- **WHEN** the owner launches a task directly
- **THEN** it SHALL record no origin and SHALL sit at depth zero
