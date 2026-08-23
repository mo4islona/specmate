## MODIFIED Requirements

### Requirement: REQ-1303 — An incomplete brief never reaches the gate

After the planner run that wrote the proposal, the parts REQ-1302 requires SHALL be checked
mechanically, with no agent judgment involved, before anything is committed. A brief missing a
required part SHALL fail the stage attempt naming what is missing, and the task SHALL NOT reach
its gate. The check SHALL judge presence, explicitness, and length only: whether the brief
persuades is the owner's judgement at the gate, never the check's.

The check SHALL run on every planner run that writes the proposal, however many the definition
schedules. It is the whole of the mechanical guarantee that the page the owner opens is complete,
so it MUST NOT be relaxed on the grounds that a later run would have caught the gap.

#### Scenario: AC-1306 — The key points are missing

- **WHEN** a planner run leaves a proposal with no key-points block
- **THEN** the attempt SHALL fail naming the missing part, nothing SHALL be committed, and the task SHALL NOT reach the gate

#### Scenario: AC-1307 — Silence about open questions

- **WHEN** a brief neither lists open questions nor states that there are none
- **THEN** the attempt SHALL fail on the missing statement

#### Scenario: AC-1308 — Complete but thin

- **WHEN** a brief carries every required part while making a weak case
- **THEN** the check SHALL pass and the task SHALL reach its gate, where rejecting it is the owner's call

#### Scenario: AC-1320 — One planner run carries the whole check

- **WHEN** a definition schedules a single planner run before the kickoff gate
- **THEN** that run's proposal SHALL be checked in full before commit, with no part deferred to a later run
