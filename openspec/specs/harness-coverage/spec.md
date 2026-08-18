# harness-coverage Specification

## Purpose
Defines the question asked before work starts: can this repository prove the change it is about
to receive? What the probe judges and how the answer is recorded, what a gap forces the brief to
say, the choice the owner makes about it and the waiver that choice produces, what building the
harness first creates, and how an accepted risk stays visible to the end. The rule behind all of
it is that a change verified by unit tests alone leaves the pipeline saying so, or does not
leave it.

## Requirements

### Requirement: REQ-1401 — Coverage is judged for the area the task touches

Planning SHALL classify how well the target repository can exercise the work this task
proposes, and SHALL judge the area the work touches rather than the repository as a whole: a
repository well covered elsewhere and uncovered where the task lands SHALL be classified on
where the task lands. The classification SHALL name what the judgement rests on — the suites,
fixtures, or simulators found, or their absence — so it can be audited without re-running the
probe. It SHALL be recorded on the task as structured data carried out of the stage's result,
never read back out of the brief's prose.

#### Scenario: AC-1401 — Covered elsewhere, uncovered here

- **WHEN** the repository has a thorough harness for one subsystem and none for the subsystem the task touches
- **THEN** the task's coverage SHALL be classified on the subsystem the task touches

#### Scenario: AC-1402 — The evidence travels with the classification

- **WHEN** a probe classifies coverage
- **THEN** the recorded classification SHALL name what it found or failed to find

#### Scenario: AC-1403 — Recorded as data

- **WHEN** planning completes
- **THEN** the task's stored coverage SHALL come from the stage's structured result, and no part of the system SHALL derive it by reading the brief

### Requirement: REQ-1402 — A gap is a warning the brief cannot omit

When coverage is anything short of adequate, the brief's key points SHALL carry a warning
stating plainly that the work cannot be properly validated and what is missing. The mechanical
brief check SHALL refuse a brief whose recorded coverage is short of adequate and whose key
points carry no such warning, exactly as it refuses a missing part. A brief MUST NOT reach the
kickoff gate while the task's coverage is unknown.

#### Scenario: AC-1404 — Missing coverage, silent brief

- **WHEN** a brief is produced for a task classified as missing and its key points do not mention it
- **THEN** the stage attempt SHALL fail naming the absent warning, and the task SHALL NOT reach its gate

#### Scenario: AC-1405 — Adequate coverage needs no warning

- **WHEN** a brief is produced for a task classified as adequate
- **THEN** the absence of a coverage warning SHALL NOT fail the check

#### Scenario: AC-1406 — Unclassified work never reaches the human

- **WHEN** planning completes without recording a classification
- **THEN** the task SHALL NOT reach its kickoff gate

### Requirement: REQ-1403 — The owner decides what to do about a gap

A task whose coverage is short of adequate SHALL reach its kickoff gate carrying a decision
offering the choice: build the harness first as a separate task this one waits on, proceed
accepting that the result cannot be properly validated, or cancel. The choice SHALL be presented
with the brief rather than parking the task before it, and its discussion SHALL let the owner
clarify the evidence and consequences without selecting an option. Approving the gate without
choosing SHALL count as proceeding, and either route SHALL record the acceptance durably on the
task as a waiver — a later reader MUST NOT have to infer it from decision history.

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

- **WHEN** a task classified as adequate reaches its gate
- **THEN** no coverage decision SHALL exist for it

#### Scenario: AC-1417 — Coverage choice is discussed without choosing

- **WHEN** the owner asks follow-up questions in the coverage decision's discussion
- **THEN** the choice SHALL remain open and no harness task or waiver SHALL be created until an option or gate outcome is explicit

### Requirement: REQ-1404 — Building the harness first is one task waiting on another

Choosing to build the harness first SHALL create a separate task against the same repository
whose request carries the probe's evidence and what the harness must cover, and SHALL make the
original wait on it. The original SHALL judge its coverage again once released, so it is
verified against the harness that now exists rather than the classification it was blocked
under. A task MUST NOT be made to wait on itself.

#### Scenario: AC-1411 — The split creates the dependency

- **WHEN** the owner chooses to build the harness first
- **THEN** a harness task SHALL exist against the same repository, carrying the probe's evidence, and the original SHALL be waiting on it

#### Scenario: AC-1412 — Released after the blocker lands

- **WHEN** the harness task reaches its terminal successfully and the original is released
- **THEN** the original SHALL re-enter its pipeline from the start, and its coverage SHALL be classified again

#### Scenario: AC-1413 — A task cannot block itself

- **WHEN** a dependency would make a task wait on itself
- **THEN** it SHALL be rejected and no dependency SHALL be recorded

### Requirement: REQ-1405 — An accepted risk stays visible to the end

A waiver SHALL travel with the task for the rest of its life: every later stage's assembled
context SHALL state it, the task view SHALL show it, and the summary produced before the final
gate SHALL state that the work was verified without a state-level harness. A waiver MUST NOT be
silently cleared; only a later classification of the same task may supersede it.

#### Scenario: AC-1414 — A later stage knows

- **WHEN** any stage runs on a task carrying a waiver
- **THEN** its assembled context SHALL state that the work is proceeding without adequate coverage

#### Scenario: AC-1415 — The summary says so

- **WHEN** a task carrying a waiver is summarised
- **THEN** the summary SHALL state that it was verified without a state-level harness

#### Scenario: AC-1416 — The owner can see it at a glance

- **WHEN** the owner opens a task carrying a waiver
- **THEN** the task view SHALL show its coverage state without the owner opening an artifact
