## ADDED Requirements

### Requirement: REQ-916 — Files changed, PR-style

The task view SHALL offer a Files-Changed view listing every file the task's code diff reports,
each showing its change status and line counts, reachable alongside the existing artifacts
link. Selecting a file SHALL render its unified diff as a readable document, not raw text. A
task with no product-code changes SHALL show an explicit empty state rather than a blank list.

#### Scenario: AC-943 — Opening the Files-Changed view

- **WHEN** the owner opens a task's Files-Changed view
- **THEN** every changed file SHALL be listed with its status and line counts

#### Scenario: AC-944 — Reading one file's diff

- **WHEN** the owner selects a file from the list
- **THEN** its unified diff SHALL render as a readable document

#### Scenario: AC-945 — No changes yet

- **WHEN** a task with no product-code changes opens its Files-Changed view
- **THEN** it SHALL show an explicit empty state instead of a blank list
