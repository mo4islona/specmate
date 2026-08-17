## Purpose

Defines what a task has spent and what happens when it has spent enough: how spend is computed
from what actually ran, when it is compared against the task's caps, what exhaustion does to a
task and asks of its owner, and how spend is reported when part of it cannot be known. The
premise is that a cap which silently never fires is worse than no cap, so one of the two
budgets is measured on our side of the provider boundary and always works.

## ADDED Requirements

### Requirement: REQ-1501 — Spend is what ran, not what elapsed

A task's spend SHALL be computed from its recorded attempts: its cost from the telemetry the
providers reported, and its agent-minutes from the durations the system itself timed for those
attempts. Time in which no agent was running for the task — waiting at a gate, waiting on a
decision, paused, blocked, or idle between stages — SHALL NOT count towards either budget.
Every agent run charged to the task SHALL count, whatever caused it, including retried attempts
and runs that are not pipeline stages.

#### Scenario: AC-1501 — A task waits overnight

- **WHEN** a task sits at a human gate for hours and is then approved
- **THEN** its agent-minutes SHALL be unchanged by the wait

#### Scenario: AC-1502 — A retry costs what it cost

- **WHEN** a stage attempt fails and is retried
- **THEN** both attempts SHALL count towards the task's spend

#### Scenario: AC-1503 — Every agent run counts

- **WHEN** a run that is not a pipeline stage is executed for a task
- **THEN** its cost and its duration SHALL count towards the same task budgets as a stage's

### Requirement: REQ-1502 — Spend is checked before dispatch and never mid-run

Before an agent run is started for a task, its spend SHALL be compared against its budgets, and
a run MUST NOT be started for a task whose spend has reached either. A run already under way
SHALL be allowed to finish and have its output recorded, however far it takes the task past a
budget: exhaustion stops the next run, never the current one.

#### Scenario: AC-1504 — Exhausted before the next stage

- **WHEN** a task's spend has reached a budget and its next stage becomes runnable
- **THEN** the stage SHALL NOT be dispatched

#### Scenario: AC-1505 — Exhausted during a run

- **WHEN** a running stage takes a task past a budget
- **THEN** that stage SHALL run to completion and its output SHALL be recorded as usual

### Requirement: REQ-1503 — Exhaustion pauses and asks

A task whose spend has reached either budget SHALL be paused with its artifacts intact, and a
decision SHALL be raised offering the owner the choice to raise the exhausted budget by a stated
amount or to cancel the task. The decision SHALL state which budget was reached, what the task
has spent against each, and what it was about to do. Resuming a paused task without raising the
budget that paused it MUST NOT be offered.

#### Scenario: AC-1506 — A budget is reached

- **WHEN** a task's cost reaches its cost budget
- **THEN** the task SHALL be paused with its artifacts intact and a decision SHALL name that budget and the task's spend against it

#### Scenario: AC-1507 — Nothing is lost

- **WHEN** a task is paused for exhaustion
- **THEN** its committed artifacts, its recorded rounds, and its stage history SHALL be unchanged

#### Scenario: AC-1508 — Resuming into the same wall is not on offer

- **WHEN** the owner is presented with the exhaustion decision
- **THEN** continuing without raising the exhausted budget SHALL NOT be among the options

### Requirement: REQ-1504 — Raising a budget is explicit and recorded

A budget SHALL be raisable only to a stated new value carried by the owner's answer, and the
raise SHALL be recorded on the task so it reports the budget it is now running under. A task
whose exhausted budget has been raised SHALL resume where it stopped. A raise that does not put
the new value above the task's current spend SHALL be refused, naming the spend, rather than
resuming a task that would pause again on its next dispatch.

#### Scenario: AC-1509 — Raised and resumed

- **WHEN** the owner answers with a new value above the task's spend
- **THEN** the task SHALL record the raised budget and resume where it stopped

#### Scenario: AC-1510 — Raised too little

- **WHEN** the owner answers with a value at or below the task's current spend
- **THEN** it SHALL be refused naming the spend, and the task SHALL stay paused

#### Scenario: AC-1511 — The task reports what it runs under

- **WHEN** a task whose budget was raised is read
- **THEN** it SHALL report the raised budget, not the one it was created with

### Requirement: REQ-1505 — Unknown spend is reported as unknown

Cost the provider did not report SHALL contribute nothing to a task's cost and MUST NOT be
recorded or presented as zero. Wherever a task's spend is read, cost that is incomplete SHALL be
marked as incomplete, so an underestimate is never presented as a fact. Agent-minutes SHALL
remain complete regardless, since the system times every run itself.

#### Scenario: AC-1512 — A provider reports no cost

- **WHEN** a task's runs completed with no cost telemetry
- **THEN** its cost spend SHALL read as incomplete rather than as zero, and its agent-minutes SHALL still be complete

#### Scenario: AC-1513 — Partly reported

- **WHEN** some of a task's runs reported cost and others did not
- **THEN** the reported cost SHALL be summed and the total SHALL be marked incomplete

#### Scenario: AC-1514 — The provider-independent cap still bites

- **WHEN** a task whose runs report no cost reaches its agent-minutes budget
- **THEN** it SHALL be paused exactly as an exhausted cost budget would pause it
