## MODIFIED Requirements

### Requirement: REQ-202 — The ledger is the only state a stage receives that is not a file

A stage SHALL receive a rendered ledger describing what the task is — including the request the
owner launched it with, in their own words — which loop and round it is in, the findings of the
previous review round, and the comments the owner left when acting at a gate. The ledger MUST
NOT contain the transcript of any earlier stage, and no conversational state between agents may
reach the agent; the owner's own words are task state, not a transcript.

#### Scenario: AC-205 — Second round of a review loop

- **WHEN** a stage is prepared for a task whose previous round produced reviewer findings
- **THEN** the ledger SHALL carry those findings

#### Scenario: AC-206 — No transcript is carried

- **WHEN** a stage is prepared for a task that has already run other stages
- **THEN** the prompt SHALL contain no output of those stages other than the artifacts they committed and the ledger

#### Scenario: AC-224 — The owner's request travels with the task

- **WHEN** a stage is prepared for a task launched with a written request
- **THEN** the ledger SHALL carry that request as the owner wrote it

#### Scenario: AC-225 — A gate comment reaches the next run

- **WHEN** a stage is prepared after the owner redirected or reworked the task with a comment
- **THEN** the ledger SHALL carry that comment
