## MODIFIED Requirements

### Requirement: REQ-916 — Files changed, PR-style

The task view SHALL offer a Files-Changed view listing every file the task's code diff reports,
each showing its change status and line counts, and SHALL group that list by what the file is —
the specification the task wrote, or the product code it changed — naming each group. The count
the surface's tab carries SHALL be the count of everything the task changed, both groups
together. A task with nothing changed SHALL show an explicit empty state rather than a blank
list.

Selecting a file SHALL render its unified diff as a readable document, not raw text, in a layer
over the surface the owner is on rather than as a navigation away from it. That layer SHALL be
openable from a file named anywhere else in the task view, and closing it SHALL return the owner
to exactly what they were reading.

#### Scenario: AC-943 — Opening the Files-Changed view

- **WHEN** the owner opens a task's Files-Changed view
- **THEN** every changed file SHALL be listed with its status and line counts

#### Scenario: AC-944 — Reading one file's diff

- **WHEN** the owner selects a file from the list
- **THEN** its unified diff SHALL render as a readable document

#### Scenario: AC-945 — No changes yet

- **WHEN** a task with nothing changed opens its Files-Changed view
- **THEN** it SHALL show an explicit empty state instead of a blank list

#### Scenario: AC-995 — A task that has only written specifications

- **WHEN** the owner opens the Files-Changed view of a task that has written specifications and no product code
- **THEN** those files SHALL be listed under the group naming them as specification, and the surface's tab SHALL count them

#### Scenario: AC-996 — A diff opened from elsewhere in the task

- **WHEN** the owner opens the diff of a file named outside the Files-Changed view
- **THEN** it SHALL open as a layer over the surface being read, and closing it SHALL leave that surface as it was

#### Scenario: AC-997 — A file with no diff to show

- **WHEN** the owner opens the diff of a file the task's comparison has nothing for
- **THEN** the layer SHALL say so rather than render as empty
