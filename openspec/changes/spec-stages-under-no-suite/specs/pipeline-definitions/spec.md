## MODIFIED Requirements

### Requirement: REQ-409 — A node may be conditional on a fact about its own input

A definition MAY declare a node conditional on a predicate evaluated when the task reaches it. A
conditional node whose predicate holds SHALL run as any other node does. A conditional node whose
predicate does not hold SHALL be skipped: the task SHALL advance to the node's forward target
without dispatching it, and the skip SHALL be recorded with the reason the predicate gives.

A gate MAY be conditional on the same terms. A gate whose predicate does not hold SHALL be skipped
without being presented to the owner, and the task SHALL advance along the gate's approve edge —
the edge a gate takes when nothing is wrong. A conditional gate is a gate the definition can
account for in advance; it is not a gate the engine may decide to stop asking.

A skipped node SHALL remain a node of the task's graph. It MUST NOT be removed from the pinned
graph, and every surface that renders the graph SHALL show it as skipped together with its reason,
in the place a node that ran states its duration. A node dropped from the graph hides the decision
that dropped it; a node skipped with a stated reason shows it.

A predicate SHALL read only facts about the node's own input — the artifacts, the task state, and
the repository-scoped state present when the task reaches it. A predicate MUST NOT read the verdict,
the findings, or any other output of the node it would skip, nor of a node that exists to check that
node's output. A node skipping itself on the strength of a judgement it exists to produce would be
deciding its own necessity from its own conclusion.

#### Scenario: AC-421 — A predicate that does not hold skips its node

- **WHEN** a task reaches a conditional node whose predicate does not hold
- **THEN** the node SHALL be skipped without dispatch, the task SHALL advance to its forward target, and the skip SHALL be recorded with the predicate's reason

#### Scenario: AC-422 — A skipped node is still shown

- **WHEN** a task's graph is rendered after a conditional node was skipped
- **THEN** the node SHALL appear in the graph marked skipped, carrying the reason where a node that ran carries its duration

#### Scenario: AC-423 — A predicate reading the output it would suppress

- **WHEN** a definition declares a predicate reading an output of the node it guards, or of a node whose purpose is to check that node
- **THEN** loading SHALL fail naming the node and the circular reading

#### Scenario: AC-429 — A gate whose predicate does not hold

- **WHEN** a task reaches a conditional gate whose predicate does not hold
- **THEN** the gate SHALL be skipped without being presented to the owner, the task SHALL advance along its approve edge, and the skip SHALL be recorded with the predicate's reason

## ADDED Requirements

### Requirement: REQ-411 — An edge into a node the task skipped is not offered

Where a gate's rework or redirect edge targets a node that was skipped on this task's walk, that
edge SHALL NOT be offered to the owner and SHALL NOT be presented on any surface that renders the
gate's choices. An edge into a node the task has already declined to run sends it somewhere it will
decline again, one loop counter poorer.

A gate left with no rework or redirect edge SHALL still present its approve and its reject: the
edges a gate always has are not the ones this suppresses.

Suppression follows the walk, not the definition. The edge SHALL remain in the pinned graph, and a
task whose profile ran the target normally SHALL be offered it.

#### Scenario: AC-430 — Rework into a skipped stage

- **WHEN** a task that skipped the specifying stage reaches a gate whose rework edges include it
- **THEN** that rework target SHALL NOT be offered, and the gate's remaining edges SHALL be offered as usual

#### Scenario: AC-431 — A gate whose every loop edge was skipped

- **WHEN** every rework and redirect target of a gate was skipped on this task's walk
- **THEN** the gate SHALL still present approve and reject

#### Scenario: AC-432 — The edge survives for a task that ran the target

- **WHEN** a task that ran the specifying stage reaches a gate whose rework edges include it
- **THEN** that rework target SHALL be offered
