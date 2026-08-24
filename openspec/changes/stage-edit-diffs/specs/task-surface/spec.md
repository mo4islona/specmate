## ADDED Requirements

### Requirement: REQ-1018 — An activity event's patch is a read of its own

A timeline read SHALL carry, for each activity event, the clamped form of any edit that event
recorded, and SHALL NOT carry the whole form. The API SHALL return the whole form for one named
activity event on request. An event carrying no edit, and an event whose whole form is the
clamped form, SHALL each answer that request without error rather than as a missing resource.

The bound exists because the timeline is read in pages of many events at once: what one screen
draws for one event MUST NOT decide what every reader of the timeline pays for every event.

#### Scenario: AC-1057 — The timeline stays bounded

- **WHEN** a task's timeline is read after a stage recorded many edits
- **THEN** each activity event SHALL carry its clamped diff and its line counts, and none SHALL carry the whole patch

#### Scenario: AC-1058 — Reading one event's whole patch

- **WHEN** the whole patch is requested for an activity event that recorded a truncated edit
- **THEN** the response SHALL return that event's whole recorded patch

#### Scenario: AC-1059 — An event that recorded no edit

- **WHEN** the whole patch is requested for an activity event that recorded no edit
- **THEN** the response SHALL say so without error rather than report the event as missing
