# kickoff-brief Specification

## Purpose

Defines the first thing a task does and the first thing its owner sees: how planning grounds a
request in the repository it targets, what the one-page brief must carry before it may be put
in front of the owner, how the questions it raises are answered alongside it, and what a
redirect carries back to the planner. This is the alignment step before research — the cheapest
place in the pipeline to correct a misunderstanding.

## Requirements

### Requirement: REQ-1301 — Planning grounds the brief in the repository

The planning stage SHALL read the owner's request and the target repository before writing
anything, and SHALL leave the change folder's proposal grounded in what it found: what the
request means in this codebase, which parts of it the work would touch, and what makes the work
risky. A claim about the repository SHALL be one the stage could make only after reading it. A
request the stage cannot place in the repository at all SHALL raise a blocking decision rather
than produce a brief resting on assumptions.

#### Scenario: AC-1301 — Grounded rather than guessed

- **WHEN** a planning stage completes
- **THEN** the proposal it leaves SHALL name the parts of the repository the work would touch

#### Scenario: AC-1302 — The request does not fit the repository

- **WHEN** planning cannot locate what the request refers to in the target repository
- **THEN** it SHALL raise a blocking decision and no brief SHALL be presented at the gate

### Requirement: REQ-1302 — The brief is one page the owner can act on

The kickoff brief stage SHALL leave the change folder's proposal as a brief carrying all of:
what will be done and why, the approach in a handful of bullets, a block of key points naming
risks, blast radius, anything irreversible, and notable trade-offs, the open questions or an
explicit statement that there are none, and the size declared by REQ-1306 with the iteration
budget that size expects. The brief's stated size SHALL be the declared size rather than a second
judgement of it. It SHALL stay within a configured length ceiling and above implementation
detail — this is the alignment step before research, not its result.

#### Scenario: AC-1303 — Every part present

- **WHEN** a brief reaches the kickoff gate
- **THEN** it SHALL carry what and why, the approach, the key points, the questions or their explicit absence, and the size with the expected iterations

#### Scenario: AC-1304 — No questions is stated, not implied

- **WHEN** the brief stage has no question to ask
- **THEN** the brief SHALL say so explicitly rather than omit the section

#### Scenario: AC-1305 — The brief stays a page

- **WHEN** a brief is produced for a large task
- **THEN** it SHALL stay within the configured ceiling, deferring detail to research rather than growing to hold it

### Requirement: REQ-1303 — An incomplete brief never reaches the gate

After any planner run that wrote the proposal — the grounding draft as much as the finished
page — the parts REQ-1302 requires SHALL be checked mechanically, with no agent judgment
involved, before anything is committed. A brief missing a
required part SHALL fail the stage attempt naming what is missing, and the task SHALL NOT reach
its gate. The check SHALL judge presence, explicitness, and length only: whether the brief
persuades is the owner's judgement at the gate, never the check's.

#### Scenario: AC-1306 — The key points are missing

- **WHEN** a planner run leaves a proposal with no key-points block
- **THEN** the attempt SHALL fail naming the missing part, nothing SHALL be committed, and the task SHALL NOT reach the gate

#### Scenario: AC-1307 — Silence about open questions

- **WHEN** a brief neither lists open questions nor states that there are none
- **THEN** the attempt SHALL fail on the missing statement

#### Scenario: AC-1308 — Complete but thin

- **WHEN** a brief carries every required part while making a weak case
- **THEN** the check SHALL pass and the task SHALL reach its gate, where rejecting it is the owner's call

### Requirement: REQ-1304 — The brief's questions are answered beside it

Questions the brief raises SHALL be recorded as non-blocking decisions, so the task reaches its
kickoff gate carrying them rather than parking short of it, and they SHALL be presented together
with the brief for the owner to discuss and answer in place. Discussion messages and proposed
answers MUST NOT resolve a question without explicit confirmation. Approving the gate SHALL
resolve every question the brief raised: answered ones keep their answers, and unanswered ones
SHALL be dismissed and readable as declined rather than as never asked. Research MUST NOT begin
with a question from the brief still open.

#### Scenario: AC-1309 — Questions travel to the gate

- **WHEN** a brief raises open questions
- **THEN** the task SHALL park at its kickoff gate with those questions open, not before the gate

#### Scenario: AC-1310 — Answered before approval

- **WHEN** the owner answers a question and then approves the gate
- **THEN** the answer SHALL be in the decision log the research stage reads

#### Scenario: AC-1311 — Approved without answering

- **WHEN** the owner approves the gate while a question from the brief is unanswered
- **THEN** that question SHALL be dismissed, and the decision log SHALL show it as declined rather than omit it

#### Scenario: AC-1315 — A brief question is clarified before answer

- **WHEN** the owner discusses a brief question beside the brief without confirming an answer
- **THEN** the question SHALL remain open, the gate actions SHALL remain available, and research SHALL NOT begin

### Requirement: REQ-1305 — A redirect regenerates for the reason it was rejected

A redirect at the kickoff gate SHALL carry the owner's comment into the state the regenerating
planner receives, so the next brief differs for the reason the last one was rejected. When the
configured number of regenerations has been spent, a further redirect SHALL be refused naming
the cap, and the gate SHALL continue to accept approval and cancellation.

#### Scenario: AC-1312 — The comment reaches the planner

- **WHEN** a brief is redirected with a comment and planning runs again
- **THEN** that comment SHALL be part of the context the planning stage receives

#### Scenario: AC-1313 — Regenerations spent

- **WHEN** the redirect cap is spent and another redirect is submitted
- **THEN** it SHALL be refused naming the cap, and the task SHALL remain at its gate with the brief it has

#### Scenario: AC-1314 — The gate still resolves

- **WHEN** the redirect cap is spent
- **THEN** approving and cancelling SHALL both remain available at the gate

### Requirement: REQ-1306 — Planning declares the shape of the work

Planning SHALL declare, as structured data carried out of the stage's result, how much process
the work needs and what must land before it: a size drawn from a closed set, and a list of
prerequisite tasks — each with a stable key, a title, and why it is needed — which MAY be empty
and SHALL be empty when the task itself was created from another task's plan at the configured
depth cap. The declaration SHALL be required from a planning stage that completed its work, and a
stage result lacking it SHALL fail the attempt exactly as a missing coverage classification does.
No part of the system SHALL derive the size or the prerequisites by reading the brief's prose.

#### Scenario: AC-1316 — Size and prerequisites recorded as data

- **WHEN** a planning stage completes its work
- **THEN** its declared size SHALL be recorded on the task from the stage's structured result, and no part of the system SHALL read it out of the brief

#### Scenario: AC-1317 — Planning completes without declaring a plan

- **WHEN** a planning stage returns a completed result carrying no plan declaration
- **THEN** the attempt SHALL fail naming what is missing, and the task SHALL NOT reach its gate

#### Scenario: AC-1318 — Nothing needs to land first

- **WHEN** planning judges that the work needs no prerequisite task
- **THEN** an empty prerequisite list SHALL be a complete declaration and no decision SHALL be raised about it

#### Scenario: AC-1319 — Planning inside a chain

- **WHEN** planning runs on a task created from another task's plan at the configured depth cap
- **THEN** the state it receives SHALL name its depth and that cap, and any prerequisites it declares anyway SHALL NOT become tasks
