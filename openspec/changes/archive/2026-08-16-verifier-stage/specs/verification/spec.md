## Purpose

Defines how an implemented change is proven against its specs: the harness-executed evidence
the verify stage must produce, the report that maps every scenario to executed assertions and
their outcomes, and the mechanical corroboration that keeps an approve verdict honest.

## ADDED Requirements

### Requirement: REQ-1101 — Verification judges by executing a harness

The verify stage SHALL judge the implemented change by executing assertions against it during
the stage and reading their outcomes — not by inspecting the code and reasoning that it looks
correct. Every outcome the stage reports SHALL come from an execution that happened within the
stage. Harness code the stage adds or extends SHALL be committed on the task branch as stage
output, so the code review that follows sees the evidence-producing code together with the
code under review.

#### Scenario: AC-1101 — Reported outcomes come from executed runs

- **WHEN** the verification report cites an assertion as covering a scenario
- **THEN** that assertion SHALL have been executed during the stage, and the reported outcome SHALL be the outcome of that execution

#### Scenario: AC-1102 — Harness code rides the task branch

- **WHEN** a verification stage that added or changed harness code completes
- **THEN** those changes SHALL be committed on the task branch like any other stage output

### Requirement: REQ-1102 — The report maps every scenario to executed assertions

The stage SHALL produce a verification report in the change folder stating, for every scenario
declared in the change's specs, the assertion or assertions covering it and each executed
outcome, in a structure plain code can parse. The report SHALL carry enough captured output
that a human can audit a failure without re-running the harness. A scenario with no covering
assertion SHALL be listed as uncovered rather than omitted.

#### Scenario: AC-1103 — Every declared scenario appears

- **WHEN** the change's specs declare a scenario
- **THEN** the report SHALL contain an entry for it — covered with executed outcomes, or explicitly uncovered

#### Scenario: AC-1104 — A failure is recorded as it happened

- **WHEN** an assertion covering a scenario fails
- **THEN** the report SHALL record the failing outcome with captured output from the run, not omit or paraphrase it

### Requirement: REQ-1103 — An approve verdict is corroborated mechanically

After a verifier run, the system SHALL cross-check the report against the change folder's
specs as the run left them, with no agent judgment involved. An approve verdict SHALL be
accepted only when every declared scenario is covered by at least one executed assertion and
every outcome reported for it is a pass. An approve the evidence does not corroborate SHALL
fail the stage attempt naming the offending scenarios, and MUST NOT advance the task.

#### Scenario: AC-1105 — Approve corroborated by the evidence

- **WHEN** the verifier returns approve and the report covers every declared scenario with passing outcomes
- **THEN** the outcome SHALL stand and the task SHALL advance along its pinned graph

#### Scenario: AC-1106 — Approve with an uncovered scenario

- **WHEN** the verifier returns approve while a declared scenario is uncovered or absent from the report
- **THEN** the stage attempt SHALL fail naming that scenario, and the task SHALL NOT advance

#### Scenario: AC-1107 — Approve contradicted by a failing outcome

- **WHEN** the verifier returns approve while the report maps a scenario only to failing outcomes
- **THEN** the stage attempt SHALL fail naming that scenario, and the task SHALL NOT advance

### Requirement: REQ-1104 — Findings are keyed by the scenario they concern

When verification does not approve, its findings SHALL identify the failing or uncovered
scenarios, and each finding's stable identifier SHALL derive from the scenario it concerns —
its acceptance ID when the scenario header carries one — so the same scenario failing again
in a later round is detectable as a recurrence from the stored rounds alone.

#### Scenario: AC-1108 — A failing scenario yields a finding

- **WHEN** a scenario's covering assertions fail and the verifier returns revise
- **THEN** the result SHALL carry a finding identifying that scenario

#### Scenario: AC-1109 — Recurrence is detectable across rounds

- **WHEN** the same scenario fails in two consecutive verification rounds
- **THEN** both rounds' findings for it SHALL carry the same identifier

### Requirement: REQ-1105 — What cannot be verified is surfaced, never skipped

A scenario the stage cannot exercise SHALL surface as an uncovered scenario in the report —
which blocks approval per REQ-1103 — and, when a human must weigh in, as a decision request.
When the harness cannot be executed at all, the stage SHALL fail naming the cause.
Verification MUST NOT approve around anything it could not check.

#### Scenario: AC-1110 — Harness cannot run at all

- **WHEN** the harness cannot be executed in the stage's environment
- **THEN** the stage SHALL fail naming the cause, and no verdict SHALL be produced

#### Scenario: AC-1111 — A scenario the stage cannot exercise

- **WHEN** a declared scenario cannot be exercised by any assertion the stage can run
- **THEN** the report SHALL list it as uncovered and the result SHALL NOT be an approve
