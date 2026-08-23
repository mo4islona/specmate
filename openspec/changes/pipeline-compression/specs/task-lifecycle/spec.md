## MODIFIED Requirements

### Requirement: REQ-602 — The happy path reaches archive

There SHALL be a legal path from a drafted task through planning, specification, implementation,
validation, summarisation, and publication to archive, passing every mandatory human gate. That
spine SHALL be present in every profile a task may run. Review of the specification is the one
stage outside the spine: it SHALL be present in the full profile and MAY be absent from a reduced
one or skipped by its own condition. No profile MAY omit a stage of the spine, a human gate, or
the validation of the code that ships.

Planning SHALL be one stage, not two. Specification SHALL be the continuation of that same stage's
work after the kickoff gate, not a fresh reading of the repository by a second role.

#### Scenario: AC-604 — Nothing needs revision

- **WHEN** every review approves and every gate is approved
- **THEN** the task SHALL be able to walk from draft to archived using only legal transitions

#### Scenario: AC-639 — The reduced profile still reaches archive

- **WHEN** a task runs a reduced profile and every gate is approved
- **THEN** it SHALL walk from planning to archived through the spine and all three human gates, using only legal transitions

#### Scenario: AC-640 — Validation is never optional

- **WHEN** any shipped profile is inspected
- **THEN** it SHALL contain the validating stage, and no profile SHALL reach publication without it

### Requirement: REQ-606 — Loops are bounded by caps

Each review loop SHALL have a maximum number of iterations, stored with the task. The caps a task
runs under SHALL be selected by the size planning declares, and SHALL remain overridable per task.
A task MUST NOT run under caps chosen for a size other than the one it declared: an iteration
budget sized for the largest work is not a bound on the smallest.

Exhausting a cap SHALL escalate to the human rather than continuing to loop or failing silently.

#### Scenario: AC-612 — Iteration cap exhausted

- **WHEN** a loop reaches its configured maximum iterations without approval
- **THEN** the task SHALL await a human decision

#### Scenario: AC-641 — Caps follow the declared size

- **WHEN** planning declares a size and the task has no explicit cap override
- **THEN** the task SHALL run under the caps that size selects, not under the caps it was created with
