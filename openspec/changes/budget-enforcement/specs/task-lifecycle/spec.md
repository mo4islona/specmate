## MODIFIED Requirements

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
