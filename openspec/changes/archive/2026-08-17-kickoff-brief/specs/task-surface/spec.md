## MODIFIED Requirements

### Requirement: REQ-1001 — Task intake

The API SHALL accept a new task carrying a title, a task type from the catalog, a repository
URL, a base branch, and optionally the owner's request in free text; create the task in its
initial state; and record its creation in the event log. When no request text is given, the
title SHALL stand as the ask rather than the task being rejected. Invalid intake MUST be
rejected with a response naming every offending field and MUST NOT create partial state.

#### Scenario: AC-1001 — Valid task submitted

- **WHEN** a create request carries a title, a known task type, a repository URL, and a branch
- **THEN** the task SHALL exist in its initial state, a creation event SHALL be appended, and the response SHALL return the task with its identity

#### Scenario: AC-1002 — Invalid intake

- **WHEN** a create request omits the title and carries an unknown task type
- **THEN** the API SHALL respond with a validation error naming both fields and no task or event SHALL be created

#### Scenario: AC-1026 — A task described in the owner's words

- **WHEN** a create request carries request text alongside the title
- **THEN** it SHALL be stored with the task and returned when the task is read
