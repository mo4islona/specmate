## MODIFIED Requirements

### Requirement: REQ-1102 — The report maps every scenario to executed assertions

The stage SHALL produce a verification report in the change folder stating, for every scenario the
change's **acceptance source** declares, the assertion or assertions covering it and each executed
outcome, in a structure plain code can parse. The report SHALL carry enough captured output
that a human can audit a failure without re-running the harness. A scenario with no covering
assertion SHALL be listed as uncovered rather than omitted.

The acceptance source is the change's specs where a specifying stage ran, and the kickoff brief's
acceptance list where none did (REQ-1706, REQ-1302). Exactly one of the two SHALL be in force for a
task, and which one SHALL follow from the profile the task ran under rather than from what the
change folder happens to contain.

#### Scenario: AC-1103 — Every declared scenario appears

- **WHEN** the change's acceptance source declares a scenario
- **THEN** the report SHALL contain an entry for it — covered with executed outcomes, or explicitly uncovered

#### Scenario: AC-1104 — A failure is recorded as it happened

- **WHEN** an assertion covering a scenario fails
- **THEN** the report SHALL record the failing outcome with captured output from the run, not omit or paraphrase it

#### Scenario: AC-1114 — The source follows the profile

- **WHEN** a task that skipped the specifying stage reaches validation
- **THEN** the acceptance source SHALL be the kickoff brief's acceptance list, and the report SHALL map every scenario it declares

### Requirement: REQ-1103 — An approve verdict is corroborated mechanically

After a validating run, the system SHALL cross-check the claims the report makes about execution
against the change's acceptance source as the run left it, with no agent judgment involved. An
approve verdict SHALL be accepted only when every declared scenario is covered by at least one
executed assertion and every outcome reported for it is a pass. An approve the evidence does not
corroborate SHALL fail the stage attempt naming the offending scenarios, and MUST NOT advance the
task.

An acceptance source declaring no scenario at all SHALL fail the stage attempt rather than
corroborate an approve. Every scenario passing is a guarantee only where there is a scenario; over
an empty inventory the same test is vacuous, and a verdict nothing can contradict is not a
corroborated one.

Corroboration SHALL reach the report's claims about execution and no further. What the stage
concluded by reading the diff is a judgement, and there is nothing to cross-check it against;
mechanically confirming a passing harness SHALL NOT be treated as confirming the verdict. A
corroborated harness is a necessary condition for approve, never a sufficient one.

#### Scenario: AC-1105 — Approve corroborated by the evidence

- **WHEN** the validating stage returns approve and the report covers every declared scenario with passing outcomes
- **THEN** the outcome SHALL stand and the task SHALL advance along its pinned graph

#### Scenario: AC-1106 — Approve with an uncovered scenario

- **WHEN** the validating stage returns approve while a declared scenario is uncovered or absent from the report
- **THEN** the stage attempt SHALL fail naming that scenario, and the task SHALL NOT advance

#### Scenario: AC-1107 — Approve contradicted by a failing outcome

- **WHEN** the validating stage returns approve while the report maps a scenario only to failing outcomes
- **THEN** the stage attempt SHALL fail naming that scenario, and the task SHALL NOT advance

#### Scenario: AC-1113 — A revise verdict over a passing harness

- **WHEN** the validating stage returns revise while every declared scenario is covered by passing assertions
- **THEN** the verdict SHALL stand and the task SHALL loop, because corroboration bounds approve and never overrides a judgement made by reading

#### Scenario: AC-1115 — An empty inventory

- **WHEN** the validating stage returns approve for a task whose acceptance source declares no scenario
- **THEN** the stage attempt SHALL fail naming the empty inventory, and the task SHALL NOT advance
