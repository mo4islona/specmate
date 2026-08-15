## ADDED Requirements

### Requirement: Stage attempts record execution telemetry

Each stage attempt SHALL record, alongside its outcome: the provider that ran it, the model
that actually served the run as the provider reported it, the start and finish times, the token
usage broken down by the kinds the provider reports, and the reported cost. Telemetry SHALL be
queryable per task and per stage without reading log files. Missing or unparseable telemetry
MUST NOT fail the stage and SHALL be recorded as absent, distinguishable from zero usage.

#### Scenario: Completed attempt inspected

- **WHEN** a completed stage attempt is read from the store
- **THEN** it SHALL carry the provider, the reported model, the start and finish times, the token counts by kind, and the reported cost

#### Scenario: Telemetry unparseable

- **WHEN** a stage completes but its telemetry envelope cannot be parsed
- **THEN** the stage outcome SHALL stand and the attempt's telemetry SHALL read as absent, not as zero

#### Scenario: Usage aggregated per task

- **WHEN** the attempts of one task are aggregated
- **THEN** the total tokens and cost per stage and per round SHALL be computable from the stored records alone
