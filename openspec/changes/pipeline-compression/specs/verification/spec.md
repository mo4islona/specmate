## MODIFIED Requirements

### Requirement: REQ-1101 — Verification judges by executing a harness

The validating stage SHALL judge the implemented change by executing assertions against it during
the stage and reading their outcomes — not by inspecting the code and reasoning that it looks
correct. Every outcome the stage reports SHALL come from an execution that happened within the
stage. Harness code the stage adds or extends SHALL be committed on the task branch as stage
output, so the evidence-producing code ships beside the code it vouches for and the owner reviews
both at the final gate.

Executing a harness SHALL NOT be the whole of the stage's judgement. The stage SHALL also read the
diff against the specification and report what it finds there, and a finding it can demonstrate
SHALL be demonstrated with a failing assertion rather than asserted in prose.

#### Scenario: AC-1101 — Reported outcomes come from executed runs

- **WHEN** the verification report cites an assertion as covering a scenario
- **THEN** that assertion SHALL have been executed during the stage, and the reported outcome SHALL be the outcome of that execution

#### Scenario: AC-1102 — Harness code rides the task branch

- **WHEN** a validating stage that added or changed harness code completes
- **THEN** those changes SHALL be committed on the task branch like any other stage output

#### Scenario: AC-1112 — A demonstrable finding is demonstrated

- **WHEN** the validating stage finds a defect an assertion could expose
- **THEN** it SHALL commit a failing assertion exposing it rather than reporting the defect in prose alone

### Requirement: REQ-1103 — An approve verdict is corroborated mechanically

After a validating run, the system SHALL cross-check the claims the report makes about execution
against the change folder's specs as the run left them, with no agent judgment involved. An approve
verdict SHALL be accepted only when every declared scenario is covered by at least one executed
assertion and every outcome reported for it is a pass. An approve the evidence does not corroborate
SHALL fail the stage attempt naming the offending scenarios, and MUST NOT advance the task.

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
