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
