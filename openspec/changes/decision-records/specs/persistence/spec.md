## MODIFIED Requirements

### Requirement: REQ-307 — Decisions are durable and answerable

Every decision SHALL be stored with the pinned-graph node that raised it, a key stable within
that node, its kind, the rendered prompt, any offered options, whether it blocks progress, and
its status. It SHALL have exactly one conversation scoped to it under REQ-1207. A resolved
decision SHALL additionally record its answer or dismissal, who resolved it, and when. At most
one **open** decision SHALL exist per task, node, and key, and the database SHALL enforce it;
resolved decisions under the same key accumulate as history rather than being overwritten. Open
decisions MUST be efficiently listable across all tasks so the Attention Inbox can be built on
them.

#### Scenario: AC-313 — Restart with an open decision

- **WHEN** the service restarts while a decision is unanswered
- **THEN** the decision SHALL still be listed as open with its original prompt intact

#### Scenario: AC-314 — Answering a decision

- **WHEN** a decision is answered
- **THEN** its status, answer text, answering identity, and answer time SHALL be persisted together

#### Scenario: AC-324 — A second open decision for one key

- **WHEN** a second open decision is written for a task, node, and key that already has one open
- **THEN** the database SHALL reject the statement

#### Scenario: AC-325 — History under one key

- **WHEN** a decision is answered and the same key is raised again at the same node
- **THEN** both records SHALL exist, the earlier one still carrying its answer

#### Scenario: AC-332 — Decision and discussion survive restart

- **WHEN** the service restarts with an open decision whose discussion has several messages
- **THEN** the same decision and its single scoped conversation SHALL remain linked with their state intact
