## ADDED Requirements

### Requirement: REQ-912 — Decisions are cards, not log lines

A decision SHALL appear in the task view as a card visually distinct from ordinary timeline
entries, rendering its question as markdown, offering its options as direct actions alongside
a free-text answer and an entry to its scoped discussion, and stating plainly when the task is
stopped on it. The discussion SHALL render as the decision's conversation rather than as
unrelated task comments. Answering or dismissing SHALL happen only through an explicit control;
afterwards the card SHALL show the outcome and offer no resolution actions while retaining its
readable discussion. Cards and discussion controls SHALL be operable on a phone-sized viewport.

#### Scenario: AC-921 — A question arrives while watching

- **WHEN** a decision is raised on a task the owner has open
- **THEN** its card SHALL appear in the timeline without a reload, marked as needing the owner

#### Scenario: AC-922 — Answering from the card

- **WHEN** the owner answers the last blocking decision from its card
- **THEN** the card SHALL show the answer and the view SHALL stop presenting the task as stopped, without a reload

#### Scenario: AC-923 — A resolved card is history

- **WHEN** a task with resolved decisions is reopened
- **THEN** their cards SHALL render the question with its answer or dismissal and offer no actions

#### Scenario: AC-924 — Answering from a phone

- **WHEN** a card with options is opened on a phone-sized viewport
- **THEN** its options and its answer input SHALL be reachable and operable without horizontal scrolling

#### Scenario: AC-933 — Discussing before answering

- **WHEN** the owner opens discussion from an unresolved decision card and asks a follow-up
- **THEN** the contextual response SHALL appear with the decision still marked unresolved and its resolution controls still available

#### Scenario: AC-934 — Proposed answer awaits confirmation

- **WHEN** the discussion proposes an answer
- **THEN** the card SHALL distinguish the proposal from the recorded outcome and require explicit confirmation before showing the decision as answered
