## MODIFIED Requirements

### Requirement: REQ-1013 — Task code diff reads

The API SHALL return, for a task, the list of files changed in the target repository between
the task branch's merge-base with its base branch and the branch's current `HEAD`, each carrying
its path, change status and added/removed line counts. The list SHALL be the code half of the
task's work: it SHALL withhold the task's own change folder, whose documents are read as
documents (REQ-907) rather than as a diff of a folder that against the merge-base is almost
always new outright. The list SHALL also name the commit it was computed against, so that a
reader can tell one comparison from the next and can drop what it recorded about an older one.

The API SHALL return the unified diff for one named file from that same comparison, for any path
the comparison covers, the change folder's own paths included — withholding a path from the list
is not refusing it to a reader who names it. That read SHALL accept how much context to return
around each hunk, bounded by a maximum the API enforces; a width the API cannot honour SHALL be
answered with the widest it will serve rather than as an error, and a width past the file's
length SHALL return the file's whole text as the hunk's context.

A task with no changes at all SHALL return an empty file list, not an error. The comparison MUST
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

#### Scenario: AC-1060 — A task that has only written specifications

- **WHEN** a task's code diff is requested after it has committed work inside its change folder and no product code
- **THEN** the response SHALL return an empty file list, no path from the change folder among it

#### Scenario: AC-1061 — One specification file's diff

- **WHEN** one file's diff is requested by a path inside the task's own change folder
- **THEN** the response SHALL return that file's unified diff rather than refuse the path

#### Scenario: AC-1079 — The list names its comparison

- **WHEN** a task's code diff is requested
- **THEN** the response SHALL name the commit the comparison was computed against, and SHALL name a different one once the task has committed again

#### Scenario: AC-1080 — Asking for more context around a hunk

- **WHEN** one file's diff is requested with a wider context than the default
- **THEN** the response SHALL return that file's diff with the requested lines surrounding each hunk, up to the maximum the API serves
