## ADDED Requirements

### Requirement: REQ-407 — A profile is a validated reduction of a base definition

The catalog SHALL be able to hold, alongside a task type's base definition, one or more reduced
profiles of it. A profile SHALL contain a subsequence of its base definition's nodes in their
original order, with the same terminal, and no node it keeps may reference a node it drops —
neither a gate's approve, redirect, or rework target, nor a loop edge's target. Both properties
SHALL be checked when the catalog loads, and a profile violating either SHALL prevent startup
naming the profile and the defect, exactly as a defective definition does. A profile MUST NOT add
a node, reorder nodes, or rewire an edge its base does not have.

#### Scenario: AC-414 — Profile keeps a node whose target it dropped

- **WHEN** a profile drops a node that a node it keeps still targets
- **THEN** loading SHALL fail naming the profile and the dangling target

#### Scenario: AC-415 — Profile reorders its base's nodes

- **WHEN** a profile's node list is not a subsequence of its base definition's
- **THEN** loading SHALL fail naming the profile

#### Scenario: AC-416 — A valid profile loads

- **WHEN** a profile drops only nodes nothing surviving references
- **THEN** it SHALL load, and every rule applying to a definition SHALL apply to it

### Requirement: REQ-408 — The declared size selects the profile a task runs

A task SHALL run the profile its declared size selects. Because the size is not known until
planning has read the repository, a task whose declared size selects a profile other than the one
its current graph names SHALL have that profile instantiated as a new run graph version at the
moment the declaration is recorded, and SHALL continue from the node the new version puts next
after the stage that declared it. The task's completed stages and their prior graph version SHALL
remain readable. A declaration selecting the profile already running SHALL NOT append a version.

#### Scenario: AC-417 — A size that reduces the walk

- **WHEN** planning declares a size whose profile drops the nodes between it and the kickoff gate
- **THEN** a new run graph version SHALL be appended from that profile and the task SHALL move to the gate rather than to the dropped node

#### Scenario: AC-418 — A size that changes nothing

- **WHEN** planning declares a size selecting the profile the task is already running
- **THEN** no new run graph version SHALL be appended and the task SHALL advance along the graph it has

#### Scenario: AC-419 — The reduced task's history survives

- **WHEN** a task has swapped to a reduced profile
- **THEN** the stages it completed under the previous version SHALL remain readable together with that version
