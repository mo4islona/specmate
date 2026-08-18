## ADDED Requirements

### Requirement: REQ-915 — The task view surfaces live stage activity, subordinate to accepted state

While a stage is running, the task view SHALL render its activity events in the timeline, each
naming the recognized action, marked visibly as in-progress rather than accepted. Once the
stage's result is accepted, its activity events SHALL be visually demoted — collapsed or removed
— rather than left standing alongside the accepted outcome. A stage with no activity events
SHALL still show as running without implying that nothing is happening; absence of activity
events MUST NOT be presented as an error or stall.

#### Scenario: AC-940 — Activity appears while a stage runs

- **WHEN** a running stage's provider CLI reports a recognized action
- **THEN** its activity event SHALL appear in the timeline marked as in-progress, without a reload

#### Scenario: AC-941 — Accepted result demotes prior activity

- **WHEN** a stage's result is accepted after it reported activity
- **THEN** the timeline SHALL show the accepted outcome and SHALL NOT present that attempt's activity events as current

#### Scenario: AC-942 — No activity yet

- **WHEN** a stage is running and no activity has been reported
- **THEN** the task view SHALL still show it as running, without presenting the absence of activity as a failure
