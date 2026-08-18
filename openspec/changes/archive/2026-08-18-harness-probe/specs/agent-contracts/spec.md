## ADDED Requirements

### Requirement: REQ-110 — A probing role reports its assessment as data

The role catalog SHALL declare which roles probe the target repository's ability to prove a
change. A probing role's result SHALL carry its coverage classification and the evidence it
rests on as structured data, and a probing role's result without one SHALL be treated as an
invalid result — retried once, then escalated — never as an absent or neutral assessment.
Consumers of the classification SHALL read it from the result, never from the artifacts the
stage wrote.

#### Scenario: AC-123 — A probing stage reports

- **WHEN** a stage for a probing role completes
- **THEN** its result SHALL carry the coverage classification and the evidence behind it

#### Scenario: AC-124 — A probing result without an assessment

- **WHEN** a probing role's result omits the classification
- **THEN** it SHALL be handled as an invalid result rather than read as unknown coverage

#### Scenario: AC-125 — A non-probing role is unaffected

- **WHEN** a role the catalog does not declare as probing returns a result without a classification
- **THEN** the result SHALL be accepted
