## MODIFIED Requirements

### Requirement: REQ-212 — A running stage emits structured activity as it proceeds

While a stage attempt is running, the executor SHALL parse the provider CLI's structured
streaming output and append a durable activity event for each recognized tool use, naming the
tool and its target. An activity event MUST be attributable to the specific stage attempt that
produced it and MUST NOT be presented as part of that attempt's accepted result. Provider CLI
output that is not a recognized structured tool-use entry MUST NOT be forwarded as an activity
event — this requirement covers summarized, recognized actions, not a relay of raw output. When
a provider's CLI does not support structured streaming output, the stage SHALL run to completion
without activity events rather than fail.

Where the recognized tool use is one that edits a file, and the reported use carries the edit it
is making, the activity event SHALL additionally carry that edit: the file's path relative to the
repository root, the count of lines added and removed, and the edit rendered as a unified diff.
The diff SHALL be bounded — both a clamped form sized for a timeline read and a whole form sized
by a hard ceiling — and a diff reaching that ceiling SHALL be recorded as truncated rather than
dropped. The event records what the tool use asked to do at the moment it asked; it MUST NOT be
presented as the state of the working tree, which no attempt is entitled to have committed yet.

Every part of this beyond the tool and its target SHALL degrade rather than fail: a tool whose
input does not carry an edit, an edit whose position in the file cannot be established, and a
provider that reports no structured input at all SHALL each yield the event without the part
that could not be established, and MUST NOT cost the run the event or the run itself.

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

#### Scenario: AC-237 — The edit travels with the event

- **WHEN** a file-editing tool use reports both the text it is replacing and the text replacing it
- **THEN** the activity event SHALL carry the repository-relative path, the added and removed line counts, and the edit as a unified diff

#### Scenario: AC-238 — An edit too large to carry whole

- **WHEN** a file-editing tool use's diff exceeds the ceiling on what one event may carry
- **THEN** the event SHALL carry the diff up to that ceiling, marked as truncated, and its line counts SHALL still describe the whole edit

#### Scenario: AC-239 — The edit cannot be reconstructed

- **WHEN** a file-editing tool use reports no usable edit, or its position in the file cannot be established
- **THEN** the activity event SHALL still be appended naming the tool and its target, without the part that could not be established
