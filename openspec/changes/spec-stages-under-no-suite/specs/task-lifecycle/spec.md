## MODIFIED Requirements

### Requirement: REQ-602 — The happy path reaches archive

There SHALL be a legal path from a drafted task through planning, implementation, validation,
summarisation, and publication to archive, passing the kickoff gate and the final gate. That spine
SHALL be present in every profile a task may run, and no profile MAY omit a stage of it, either of
those two gates, or the validation of the code that ships.

Specification is on the graph rather than on the spine. The specifying stage and the specification
gate SHALL be present in every profile, and both MAY be skipped by their own condition — which,
under the profile none, is what REQ-1706 requires of them. Review of the specification is weaker
still: it SHALL be present in the full profile and MAY be absent from a reduced one or skipped by
its own condition. A specification a repository has nowhere to keep is work the task can decline;
running the code that ships and judging it is not.

Planning SHALL be one stage, not two. Where the specifying stage runs, it SHALL be the continuation
of that same stage's work after the kickoff gate, not a fresh reading of the repository by a second
role.

#### Scenario: AC-604 — Nothing needs revision

- **WHEN** every review approves and every gate is approved
- **THEN** the task SHALL be able to walk from draft to archived using only legal transitions

#### Scenario: AC-639 — The reduced profile still reaches archive

- **WHEN** a task runs a reduced profile and every gate is approved
- **THEN** it SHALL walk from planning to archived through the spine and every gate that profile presents, using only legal transitions

#### Scenario: AC-640 — Validation is never optional

- **WHEN** any shipped profile is inspected
- **THEN** it SHALL contain the validating stage, and no profile SHALL reach publication without it

#### Scenario: AC-642 — A task with no specification segment reaches archive

- **WHEN** a task skips the specifying stage, its review and the specification gate, and every remaining gate is approved
- **THEN** it SHALL walk from planning to archived using only legal transitions

#### Scenario: AC-643 — The two remaining gates are never skipped

- **WHEN** any shipped profile is inspected under any spec convention profile
- **THEN** the kickoff gate and the final gate SHALL be present and unconditional

#### Scenario: AC-644 — The specification nodes stay on the graph

- **WHEN** the graph of a task that skipped the specification segment is inspected
- **THEN** the specifying stage and the specification gate SHALL still be nodes of it, marked skipped
