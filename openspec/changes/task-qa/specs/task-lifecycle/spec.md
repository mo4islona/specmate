## MODIFIED Requirements

### Requirement: REQ-613 — Stage failure is retried up to a cap, then fails the task

A stage attempt that fails — timeout, invalid result after the runner's own retry, scope
violation, or crash — SHALL have its uncommitted work discarded and SHALL be re-dispatched with
an incremented attempt number, up to a configured per-stage failure cap. Exhausting the cap SHALL
move the task to failed, recording the stage and final reason. Every failed attempt SHALL be
recorded; failure MUST NOT be silent. An attempt the owner explicitly interrupts under REQ-1607
SHALL instead be recorded as `interrupted` and MUST NOT count towards the failure cap. The task
SHALL remain paused after cleanup; if the owner later restarts it, the new attempt SHALL begin
from committed state with an incremented attempt number.

#### Scenario: AC-622 — Retry starts from committed state

- **WHEN** an attempt fails after half-rewriting artifacts and a retry is dispatched
- **THEN** the retry SHALL read the artifacts as last committed, not as the failed attempt left them

#### Scenario: AC-623 — Attempt cap exhausted

- **WHEN** a stage's failure cap is spent without a successful attempt
- **THEN** the task SHALL move to failed and the record SHALL name the stage and the last failure reason

#### Scenario: AC-631 — Owner interruption does not spend the failure cap

- **WHEN** the owner interrupts a running stage and it restarts with confirmed guidance
- **THEN** the interrupted attempt SHALL remain visible and its replacement SHALL start without increasing the consecutive-failure count
