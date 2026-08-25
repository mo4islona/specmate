## MODIFIED Requirements

### Requirement: REQ-1302 — The brief is one page the owner can act on

The kickoff brief stage SHALL leave the change folder's proposal as a brief carrying all of:
what will be done and why, the approach in a handful of bullets, a block of key points naming
risks, blast radius, anything irreversible, and notable trade-offs, the open questions or an
explicit statement that there are none, and the size declared by REQ-1306 with the iteration
budget that size expects. The brief's stated size SHALL be the declared size rather than a second
judgement of it. It SHALL stay within a configured length ceiling and above implementation
detail — this is the alignment step before research, not its result.

Where the profile in force is none, the brief SHALL additionally carry an **acceptance list**: the
scenarios the change must satisfy, each stated as a condition and the outcome it must produce, in a
structure plain code can parse. It is the inventory validation corroborates an approve against
(REQ-1103), because under that profile no specifying stage runs to declare one (REQ-1706). Each
scenario SHALL be testable — an outcome a harness can execute and judge — and SHALL cite no
identifier from a suite the repository does not have.

Under any other profile the brief SHALL NOT carry an acceptance list. There the specification
declares the scenarios, and a second inventory beside it would be a second normative source for the
same behaviour.

#### Scenario: AC-1303 — Every part present

- **WHEN** a brief reaches the kickoff gate
- **THEN** it SHALL carry what and why, the approach, the key points, the questions or their explicit absence, and the size with the expected iterations

#### Scenario: AC-1304 — No questions is stated, not implied

- **WHEN** the brief stage has no question to ask
- **THEN** the brief SHALL say so explicitly rather than omit the section

#### Scenario: AC-1305 — The brief stays a page

- **WHEN** a brief is produced for a large task
- **THEN** it SHALL stay within the configured ceiling, deferring detail to research rather than growing to hold it

#### Scenario: AC-1326 — The acceptance list under no suite

- **WHEN** a brief is produced for a task whose profile is none
- **THEN** it SHALL carry an acceptance list of testable scenarios in a parsable structure, citing no identifier from a suite

#### Scenario: AC-1327 — No acceptance list where a suite exists

- **WHEN** a brief is produced for a task running under a specification suite
- **THEN** it SHALL NOT carry an acceptance list, and the change's specification SHALL remain the only inventory

### Requirement: REQ-1303 — An incomplete brief never reaches the gate

After the planner run that wrote the proposal, the parts REQ-1302 requires SHALL be checked
mechanically, with no agent judgment involved, before anything is committed. A brief missing a
required part SHALL fail the stage attempt naming what is missing, and the task SHALL NOT reach
its gate. The check SHALL judge presence, explicitness, and length only: whether the brief
persuades is the owner's judgement at the gate, never the check's.

Under the profile none the acceptance list is such a part. Its absence, or its presence with no
scenario in it, SHALL fail the stage attempt the way any other missing part does. Whether a
scenario is a good one is the owner's judgement at the gate; that there is one to read is not.

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

#### Scenario: AC-1322 — One planner run carries the whole check

- **WHEN** a definition schedules a single planner run before the kickoff gate
- **THEN** that run's proposal SHALL be checked in full before commit, with no part deferred to a later run

#### Scenario: AC-1328 — An empty acceptance list under no suite

- **WHEN** a planner run under the profile none leaves a brief whose acceptance list is absent or holds no scenario
- **THEN** the attempt SHALL fail naming it, nothing SHALL be committed, and the task SHALL NOT reach the gate
