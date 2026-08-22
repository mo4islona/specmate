## RENAMED Requirements

- FROM: `### Requirement: REQ-1404 — Building the harness first is one task waiting on another`
- TO: `### Requirement: REQ-1404 — Work that must land first is one task waiting on another`

## MODIFIED Requirements

### Requirement: REQ-1403 — The owner decides what to do about a gap

A task SHALL reach its kickoff gate carrying a decision offering the choice — do the proposed
work first as separate tasks this one waits on, proceed as one task, or cancel — whenever its
coverage is short of adequate, whenever its plan proposes prerequisite tasks, or both. The choice
SHALL name what it would create: the tasks the plan proposed, or, when coverage is short and the
plan proposed none, one task for the harness the probe found missing. Creating further tasks
SHALL NOT be offered to a task at the configured depth cap, and the choice SHALL say so rather
than present a shorter list without explanation. The choice SHALL be presented with the brief
rather than parking the task before it, and its discussion SHALL let the owner clarify the
evidence and consequences without selecting an option. Approving the gate without choosing SHALL
count as proceeding, and where coverage was short either route SHALL record the acceptance
durably on the task as a waiver — a later reader MUST NOT have to infer it from decision history.

#### Scenario: AC-1407 — The choice arrives with the brief

- **WHEN** a task classified as partial reaches its kickoff gate
- **THEN** the decision offering split, proceed, and cancel SHALL be open and presented with the brief

#### Scenario: AC-1408 — Proceeding is recorded

- **WHEN** the owner chooses to proceed
- **THEN** the task's coverage SHALL record the waiver, and research SHALL begin

#### Scenario: AC-1409 — Approving without choosing

- **WHEN** the owner approves the kickoff gate leaving the coverage decision unanswered
- **THEN** it SHALL be treated as proceeding: the waiver SHALL be recorded and the decision SHALL resolve

#### Scenario: AC-1410 — Adequate coverage raises nothing

- **WHEN** a task classified as adequate reaches its gate and its plan proposes no prerequisite
- **THEN** no coverage decision SHALL exist for it

#### Scenario: AC-1417 — Coverage choice is discussed without choosing

- **WHEN** the owner asks follow-up questions in the coverage decision's discussion
- **THEN** the choice SHALL remain open and no task or waiver SHALL be created until an option or gate outcome is explicit

#### Scenario: AC-1418 — Adequate coverage, but the plan proposes work first

- **WHEN** a task classified as adequate reaches its gate with prerequisites in its plan
- **THEN** the decision SHALL be open, naming the proposed tasks

#### Scenario: AC-1419 — The split option at the depth cap

- **WHEN** a task at the configured depth cap reaches its gate with a coverage gap
- **THEN** its choice SHALL offer only proceeding and cancelling, and SHALL state that the depth cap is why

### Requirement: REQ-1404 — Work that must land first is one task waiting on another

Choosing to do the proposed work first SHALL create the tasks the plan proposed — or, when the
plan proposed none and coverage is short of adequate, one harness task carrying the probe's
evidence and what the harness must cover — each against the same repository, each recording the
task whose plan created it and its depth in that chain, and SHALL make the original wait on all
of them. No more than the configured number of tasks SHALL be created from one plan. The original
SHALL judge its coverage again once released, so it is verified against the world its blockers
left rather than the classification it was blocked under. A task MUST NOT be made to wait on
itself.

#### Scenario: AC-1411 — The split creates the dependency

- **WHEN** the owner chooses to do the proposed work first
- **THEN** a task SHALL exist for each proposal against the same repository, and the original SHALL be waiting on all of them

#### Scenario: AC-1412 — Released after the blocker lands

- **WHEN** every task the original waits on reaches its terminal successfully and the original is released
- **THEN** the original SHALL re-enter its pipeline from the start, and its coverage SHALL be classified again

#### Scenario: AC-1413 — A task cannot block itself

- **WHEN** a dependency would make a task wait on itself
- **THEN** it SHALL be rejected and no dependency SHALL be recorded

#### Scenario: AC-1420 — Splitting with nothing proposed

- **WHEN** the owner chooses to split a task whose coverage is short of adequate and whose plan proposed no prerequisite
- **THEN** exactly one harness task SHALL be created carrying the probe's evidence, and the original SHALL wait on it

#### Scenario: AC-1421 — The created tasks carry their lineage

- **WHEN** tasks are created from a plan
- **THEN** each SHALL record the task whose plan created it and a depth one greater than that task's
