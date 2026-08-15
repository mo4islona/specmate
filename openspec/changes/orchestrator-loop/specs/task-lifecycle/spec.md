## MODIFIED Requirements

### Requirement: Task states and legal transitions

The system SHALL derive a task's legal transitions from its pinned pipeline — its forward
edges, loop edges, and gate resolutions — together with the type-independent interrupt states,
which MAY be entered from any active state and SHALL return the task to the state they
interrupted. A transition outside that derived set MUST be rejected. State SHALL be changed only
by the orchestrator, never by an agent's output.

#### Scenario: Illegal transition attempted

- **WHEN** a transition not derivable from the task's pinned pipeline or the interrupt rules is attempted
- **THEN** it SHALL be rejected and the task SHALL remain in its current state

#### Scenario: Agent result implies a state

- **WHEN** an agent's result suggests the task should advance
- **THEN** the orchestrator SHALL decide the transition; the agent's output alone SHALL NOT change state

#### Scenario: Two tasks with different pipelines

- **WHEN** two tasks pinned to different pipeline definitions are inspected
- **THEN** each SHALL accept only the transitions its own pinned graph derives, under one and the same engine

## ADDED Requirements

### Requirement: The engine advances a task from stored state alone

After a stage completes, the next transition SHALL be determined solely by the pinned graph,
the recorded outcome, the stored rounds, and the task's caps: success on a non-review stage
advances along the forward edge, an approve verdict advances, a revise verdict records the round
and follows the loop edge when the round fits the cap, and an escalate verdict or an exhausted
cap parks the task awaiting a human. The engine MUST NOT branch on task type, role, or node
identity beyond what the pinned graph declares.

#### Scenario: Revise within the cap

- **WHEN** a review stage returns revise and the loop's used rounds are below its cap
- **THEN** the round SHALL be recorded with its verdict and findings and the task SHALL follow the loop edge

#### Scenario: Revise at the cap

- **WHEN** a review stage returns revise and another round would exceed the loop's cap
- **THEN** the task SHALL park awaiting a human and no further stage SHALL be dispatched

#### Scenario: Approval advances

- **WHEN** a review stage returns approve
- **THEN** the task SHALL move to the pinned graph's forward target of that stage

### Requirement: Stage failure is retried up to a cap, then fails the task

A stage attempt that fails for any reason — timeout, invalid result after the runner's own
retry, scope violation, or a crash — SHALL have its uncommitted work discarded and SHALL be
re-dispatched with an incremented attempt number, up to a configured per-stage attempt cap.
Exhausting the cap SHALL move the task to failed, recording the stage and the final reason.
Every failed attempt SHALL be recorded; failure MUST NOT be silent.

#### Scenario: Retry starts from committed state

- **WHEN** an attempt fails after half-rewriting artifacts and a retry is dispatched
- **THEN** the retry SHALL read the artifacts as last committed, not as the failed attempt left them

#### Scenario: Attempt cap exhausted

- **WHEN** a stage's attempt cap is spent without a successful attempt
- **THEN** the task SHALL move to failed and the record SHALL name the stage and the last failure reason

### Requirement: A restart recovers every task from the store

After an orchestrator restart, every non-terminal task SHALL resume from persisted state alone.
A stage recorded as running with no live execution behind it SHALL be treated as a failed
attempt: its execution SHALL be terminated if still present, its workspace discarded, and the
stage re-dispatched under the same attempt cap, updating the interrupted attempt's record rather
than duplicating it. A task parked at a gate or awaiting a human SHALL remain parked across the
restart.

#### Scenario: Killed mid-stage

- **WHEN** the orchestrator is killed while a stage runs and is then restarted
- **THEN** the interrupted attempt SHALL be recorded as failed and the stage SHALL run again as the next attempt, and the task SHALL continue from its outcome

#### Scenario: Restart while parked

- **WHEN** the orchestrator restarts while a task waits at a human gate
- **THEN** the task SHALL still be parked at that gate and nothing SHALL be dispatched for it
