## ADDED Requirements

### Requirement: REQ-1013 — Task code diff reads

The API SHALL return, for a task, the list of files changed in the target repository between
the task branch's merge-base with its base branch and the branch's current `HEAD`, excluding
the OpenSpec change folder, each carrying its path, change status, and added/removed line
counts; and SHALL return the unified diff for one named file from that same comparison. A task
with no product-code changes SHALL return an empty file list, not an error. The comparison MUST
NOT depend on the task's per-task workspace still existing — reading the diff of a task whose
workspace has been released after archiving SHALL return the same result as before release.

#### Scenario: AC-1034 — Files changed for a task with commits

- **WHEN** a task's code diff is requested and its branch has committed product-code changes
- **THEN** the response SHALL list every changed file with its status and line counts

#### Scenario: AC-1035 — No product-code changes yet

- **WHEN** a task's code diff is requested before any product-code commit exists
- **THEN** the response SHALL return an empty file list rather than an error

#### Scenario: AC-1036 — One file's diff

- **WHEN** one file's diff is requested by path from a task's code diff
- **THEN** the response SHALL return that file's unified diff as of the branch's current `HEAD`

#### Scenario: AC-1037 — Reading an archived task's diff

- **WHEN** a code diff is requested for a task whose workspace has been released after archiving
- **THEN** the response SHALL be the same as before release, computed from the repository's shared mirror
