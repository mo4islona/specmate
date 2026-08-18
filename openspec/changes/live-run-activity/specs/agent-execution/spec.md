## ADDED Requirements

### Requirement: REQ-212 — A running stage emits structured activity as it proceeds

While a stage attempt is running, the executor SHALL parse the provider CLI's structured
streaming output and append a durable activity event for each recognized tool use, naming the
tool and its target. An activity event MUST be attributable to the specific stage attempt that
produced it and MUST NOT be presented as part of that attempt's accepted result. Provider CLI
output that is not a recognized structured tool-use entry MUST NOT be forwarded as an activity
event — this requirement covers summarized, recognized actions, not a relay of raw output. When
a provider's CLI does not support structured streaming output, the stage SHALL run to completion
without activity events rather than fail.

#### Scenario: AC-226 — Editing a file mid-run

- **WHEN** a running attempt's provider CLI reports a file-editing tool use
- **THEN** an activity event naming that tool and the file path SHALL be appended to the event log, attributed to the running attempt

#### Scenario: AC-227 — Unrecognized CLI output

- **WHEN** the provider CLI emits output that is not a recognized structured tool-use entry
- **THEN** no activity event SHALL be produced for it

#### Scenario: AC-228 — Provider without structured streaming

- **WHEN** a stage runs under a provider whose CLI does not support structured streaming output
- **THEN** the stage SHALL run to completion without activity events rather than fail

#### Scenario: AC-229 — A retried attempt gets its own activity

- **WHEN** a stage is retried after a failed attempt that had produced activity events
- **THEN** the new attempt's activity events SHALL be attributed to it, distinguishable from the discarded attempt's
