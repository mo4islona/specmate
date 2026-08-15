## Purpose

Defines the states a task moves through from draft to archive, which transitions are legal,
where the human must be asked, and what stops the research↔review loop from running forever.
The orchestrator owns these transitions; agents never set state.

## ADDED Requirements

### Requirement: Task states and legal transitions

The system SHALL define the set of task states and, for each, the states it may move to. A
transition outside that set MUST be rejected. State SHALL be changed only by the orchestrator,
never by an agent's output.

#### Scenario: Illegal transition attempted

- **WHEN** a transition not listed for the current state is attempted
- **THEN** it SHALL be rejected and the task SHALL remain in its current state

#### Scenario: Agent result implies a state

- **WHEN** an agent's result suggests the task should advance
- **THEN** the orchestrator SHALL decide the transition; the agent's output alone SHALL NOT change state

### Requirement: The happy path reaches archive

There SHALL be a legal path from a drafted task through planning, kickoff brief, research,
spec review, implementation, verification, code review, summarisation, and publication to
archive.

#### Scenario: Nothing needs revision

- **WHEN** every review approves and every gate is approved
- **THEN** the task SHALL be able to walk from draft to archived using only legal transitions

### Requirement: Review loops go backwards, never forwards

A review that requests changes SHALL return the task to the stage that produces the artifacts
under review. A review MUST NOT be able to skip the stages between itself and publication.

#### Scenario: Spec review requests changes

- **WHEN** spec review returns a revise verdict
- **THEN** the task SHALL return to research

#### Scenario: Code review requests changes

- **WHEN** code review returns a revise verdict
- **THEN** the task SHALL return to implementation

#### Scenario: Code review cannot publish

- **WHEN** a transition directly from code review to publication is attempted
- **THEN** it SHALL be rejected

### Requirement: Three mandatory human gates

The system SHALL require explicit human approval at exactly three points: the kickoff brief
before research begins, the specification before code is written, and the final summary before
publication. All other transitions MAY proceed without the human.

#### Scenario: Gate inventory

- **WHEN** the states are inspected
- **THEN** exactly the kickoff, specification, and final states SHALL be marked as human gates

#### Scenario: Research before approval

- **WHEN** a task's kickoff brief has not been approved
- **THEN** research SHALL NOT begin

### Requirement: Kickoff redirect is bounded

At the kickoff gate the human SHALL be able to approve, redirect with a comment, or cancel. A
redirect SHALL return the task to planning to regenerate the brief, and the number of
regenerations SHALL be capped.

#### Scenario: Redirect at kickoff

- **WHEN** the human redirects a kickoff brief
- **THEN** the task SHALL return to planning and the comment SHALL be recorded as feedback

#### Scenario: Redirect cap reached

- **WHEN** the configured number of regenerations has been used
- **THEN** the task SHALL stop regenerating and require a decision from the human

### Requirement: Loops are bounded by caps

Each review loop SHALL have a maximum number of iterations, configurable per task and stored
with the task. Exhausting a cap SHALL escalate to the human rather than continuing to loop or
failing silently.

#### Scenario: Iteration cap exhausted

- **WHEN** a loop reaches its configured maximum iterations without approval
- **THEN** the task SHALL await a human decision

### Requirement: Repeated findings escalate

When a reviewer returns the same finding identifier in consecutive rounds up to the configured
threshold, the orchestrator SHALL escalate to the human instead of running another round.

#### Scenario: Reviewer repeats itself

- **WHEN** the same finding identifier is returned in consecutive rounds up to the threshold
- **THEN** the task SHALL await a human decision rather than starting another round

### Requirement: Budgets pause rather than fail

Each task SHALL carry a wall-clock and a cost budget. Exceeding either SHALL pause the task and
raise it to the human, and MUST NOT discard work already done.

#### Scenario: Cost budget exceeded mid-run

- **WHEN** a task's cost budget is exhausted
- **THEN** the task SHALL pause with its artifacts intact and the human SHALL be notified

### Requirement: Interruptions remember where to resume

A task interrupted to wait for a human, or paused, SHALL record the state it was interrupted in
so it can resume exactly there once resolved.

#### Scenario: Decision answered

- **WHEN** the human answers the decision that blocked a task
- **THEN** the task SHALL resume in the state it was interrupted in

### Requirement: Terminal states are terminal

An archived or cancelled task SHALL have no outgoing transitions and MUST NOT be pausable,
cancellable, or resumable. A failed task MAY be restarted from an earlier stage, because
failure is recoverable while completion is not.

#### Scenario: Cancelling an archived task

- **WHEN** cancellation is attempted on an archived task
- **THEN** it SHALL be rejected

#### Scenario: Restarting a failed task

- **WHEN** a failed task is restarted
- **THEN** it SHALL be allowed to re-enter an earlier stage

### Requirement: Rework re-enters at the affected stage

After the final gate the human SHALL be able to send a task back for rework, and the task SHALL
re-enter only the affected stages rather than restarting the pipeline. Iteration counters for
the new round SHALL start again under their own cap.

#### Scenario: Rework touches only code

- **WHEN** the human sends a summarised task back with implementation-level comments
- **THEN** the task SHALL return to implementation rather than to research
