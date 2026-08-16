## MODIFIED Requirements

### Requirement: REQ-104 — Review verdicts and stable findings

The result of a reviewing stage — the reviewer's review and the verifier's verification —
SHALL carry a verdict of `approve`, `revise`, or `escalate`, and its findings SHALL each carry
an identifier that is stable across rounds, a severity, and a title. A `revise` verdict SHALL
carry at least one finding. Stable identifiers exist so that the same finding recurring across
rounds is detectable. A reviewing stage's result without a verdict SHALL be treated as an
invalid result, never as an approval.

#### Scenario: AC-110 — Reviewer requests changes

- **WHEN** a reviewer returns `revise` with findings
- **THEN** the verdict and every finding identifier SHALL be persisted for that round

#### Scenario: AC-111 — Same finding returned twice

- **WHEN** a finding with an identifier already seen in the previous round is returned again
- **THEN** the orchestrator SHALL be able to detect the repetition from the stored rounds alone

#### Scenario: AC-121 — Verifier returns a verdict

- **WHEN** a verification run completes
- **THEN** its result SHALL carry a verdict the orchestrator can act on, in the same shape as the reviewer's

#### Scenario: AC-122 — Reviewing result without a verdict

- **WHEN** a reviewer's or verifier's result omits the verdict
- **THEN** it SHALL be handled as an invalid result — retried once, then escalated — rather than read as an approval
