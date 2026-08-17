## MODIFIED Requirements

### Requirement: REQ-105 — Decisions are requested, never assumed

When an agent cannot resolve a question on its own, it SHALL request a decision rather than
choosing. Each request SHALL carry a key that is stable within the stage node that raises it —
across that node's attempts and its later rounds, not merely within one attempt — a kind, a
rendered prompt, any offered options, whether it blocks progress, and enough explanation or
artifact references for an owner-facing discussion to examine why the choice is needed.

#### Scenario: AC-112 — Ambiguous requirement encountered

- **WHEN** a researcher meets a requirement it cannot resolve from the repository or the artifacts
- **THEN** its result SHALL contain a decision request rather than an assumed answer

#### Scenario: AC-113 — Question re-asked after a retry

- **WHEN** a stage is retried and asks the same question
- **THEN** the stable key SHALL let it be matched to the existing decision instead of creating a duplicate

#### Scenario: AC-128 — Decision enters discussion

- **WHEN** an agent requests a decision whose options require clarification
- **THEN** its rendered prompt or artifact references SHALL give the decision discussion enough task-grounded context to explain the choice without inventing rationale
