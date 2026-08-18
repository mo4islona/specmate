## ADDED Requirements

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
