## RENAMED Requirements

- FROM: `### Requirement: REQ-301 — Git holds artifacts, Postgres indexes them`
- TO: `### Requirement: REQ-301 — Where artifact content lives, and which store wins`

## MODIFIED Requirements

### Requirement: REQ-301 — Where artifact content lives, and which store wins

Artifact content SHALL live in the task's change folder. Where that folder is part of the target
repository, git SHALL hold it: the database SHALL store, per artifact, its path, its kind, the git
object it was last seen at, and a rendered snapshot used only for display, and when snapshot and git
disagree, git wins.

Where the change folder is not part of the repository (REQ-1707) there is no git object to defer to.
The database SHALL then hold that artifact's content whole and SHALL be authoritative for it, and a
ceiling that exists to bound a display copy MUST NOT be applied to the only copy there is.

Under either store, a stage SHALL read artifact content from the change folder in its workspace. The
stored copy is what the owner's surfaces and publication read, never what a role is given.

#### Scenario: AC-301 — Reconstructing agent context

- **WHEN** a stage assembles its prompt
- **THEN** artifact content SHALL be read from the change folder in the workspace, not from the stored copy

#### Scenario: AC-302 — Rendering an artifact in the UI

- **WHEN** the UI displays an artifact and a stored copy exists
- **THEN** it MAY be served directly, together with the git object it came from where there is one

#### Scenario: AC-353 — The stored copy is the only copy

- **WHEN** an artifact whose change folder the repository does not carry is stored
- **THEN** its content SHALL be stored whole and SHALL be authoritative, rather than truncated as a display copy
