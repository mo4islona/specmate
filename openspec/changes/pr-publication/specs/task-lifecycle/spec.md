## ADDED Requirements

### Requirement: REQ-616 — Publication pushes the branch and opens a pull request

On entering `publish`, the orchestrator SHALL push the task's branch to its target repository's
remote and open a pull request against the task's base branch, using the task's title and its
already-approved final summary as the pull request's title and body. A successful publish SHALL
record exactly one pull request for the task and advance it to `archived`. Publish MUST NOT
depend on any credential reachable from a stage or an agent run.

#### Scenario: AC-632 — Publish succeeds

- **WHEN** a task enters publish and both the push and the pull-request creation succeed
- **THEN** the task SHALL advance to archived and exactly one pull request SHALL be recorded for it

#### Scenario: AC-633 — Publish re-entered after already succeeding

- **WHEN** a task re-enters publish and a pull request is already recorded for it
- **THEN** the orchestrator SHALL NOT open a second pull request

#### Scenario: AC-634 — Publish fails

- **WHEN** the push or the pull-request creation fails
- **THEN** the task SHALL move to failed, naming the reason, rather than remaining in publish indefinitely
