## ADDED Requirements

### Requirement: REQ-617 — A task created from a plan records its origin, and chains are bounded

A task created from another task's plan SHALL record the task whose plan created it and how deep
in that chain it sits, so the chain is readable from the task alone. Depth SHALL be bounded by a
configured cap: a task at the cap MUST NOT create further tasks, and the choice to do so MUST NOT
be offered for it. The number of tasks one plan may create SHALL be bounded by a configured cap
of its own, and anything the plan proposed beyond that cap SHALL be named to the owner rather
than silently dropped. A task the owner launched SHALL be at depth zero with no origin.

#### Scenario: AC-635 — The chain is readable from the task

- **WHEN** a task created from another task's plan is inspected
- **THEN** it SHALL name the task whose plan created it and its depth in that chain

#### Scenario: AC-636 — At the depth cap

- **WHEN** a task at the configured depth cap reaches its kickoff gate with a coverage gap or a proposed plan
- **THEN** creating further tasks SHALL NOT be among its options, and the reason SHALL be stated with the choice

#### Scenario: AC-637 — More prerequisites than the cap allows

- **WHEN** a plan proposes more prerequisite tasks than the configured cap allows
- **THEN** at most the cap SHALL be created, and the proposals not created SHALL be named to the owner

#### Scenario: AC-638 — An owner-launched task

- **WHEN** the owner launches a task directly
- **THEN** it SHALL record no origin and SHALL sit at depth zero

## MODIFIED Requirements

### Requirement: REQ-602 — The happy path reaches archive

There SHALL be a legal path from a drafted task through planning, research, implementation,
verification, summarisation, and publication to archive, passing every mandatory human gate. That
spine SHALL be present in every profile a task may run. Stages outside it — a second planning pass
producing the brief, and review of the specification — SHALL be present in the full profile and
MAY be absent from a reduced one; no profile MAY omit a stage of the spine, a human gate, or the
review of the code that ships.

#### Scenario: AC-604 — Nothing needs revision

- **WHEN** every review approves and every gate is approved
- **THEN** the task SHALL be able to walk from draft to archived using only legal transitions

#### Scenario: AC-639 — The reduced profile still reaches archive

- **WHEN** a task runs a reduced profile and every gate is approved
- **THEN** it SHALL walk from planning to archived through the spine and all three human gates, using only legal transitions
