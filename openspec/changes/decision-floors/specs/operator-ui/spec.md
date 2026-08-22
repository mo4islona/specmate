## ADDED Requirements

### Requirement: REQ-918 — Settings shows what the system remembers across tasks

The Settings screen SHALL carry a section listing the decisions still in force beyond the task
that made them, each naming the repository it applies to, what was accepted, and the task that
accepted it, with a control revoking one. A revoked decision SHALL leave the list without a
reload. When nothing is in force, the section SHALL say so explicitly rather than render an empty
list.

#### Scenario: AC-950 — Reviewing what is in force

- **WHEN** the owner opens Settings with an accepted coverage gap in force
- **THEN** the section SHALL name the repository it applies to and the task that accepted it

#### Scenario: AC-951 — Revoking from Settings

- **WHEN** the owner revokes one from the section
- **THEN** it SHALL leave the list, and the next task with a gap in that repository SHALL be asked rather than inherit it

#### Scenario: AC-952 — Nothing remembered

- **WHEN** no decision is in force beyond its task
- **THEN** the section SHALL state that explicitly
