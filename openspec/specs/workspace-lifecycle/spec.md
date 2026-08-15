# workspace-lifecycle Specification

## Purpose
Defines where a task's agents do their work: how a task acquires an isolated checkout of its
target repository, how each stage's output becomes durable before the task advances, and when a
workspace is reused, repaired, or destroyed. This is the boundary that keeps agents away from
the base branch and keeps crashes from costing work.

## Requirements

### Requirement: One isolated working tree per task

Each task SHALL run in its own working tree of its target repository, checked out to a branch
named after the task and cut from the task's base branch. Two tasks MUST NOT share a working
tree, and no stage may run in a checkout of the base branch itself.

#### Scenario: Two tasks against one repository

- **WHEN** two tasks are provisioned for the same target repository
- **THEN** each SHALL receive its own working tree at its own path, on its own branch

#### Scenario: The base branch is never written

- **WHEN** a task's stages commit their output
- **THEN** the base branch SHALL still point at the commit it pointed at when the task started

### Requirement: Provisioning is idempotent and self-repairing

Provisioning a workspace SHALL be safe to repeat. A second request for a task's workspace SHALL
return the existing one with its commits intact. Provisioning interrupted part-way SHALL be
completed on the next request rather than started over, and committed work MUST survive any
repair.

#### Scenario: Workspace requested twice

- **WHEN** a workspace is requested for a task that already has one
- **THEN** the same working tree SHALL be returned, and commits already on its branch SHALL remain

#### Scenario: Interrupted provisioning

- **WHEN** provisioning is requested for a task whose branch exists but whose working tree was never created
- **THEN** provisioning SHALL create the working tree from the existing branch rather than failing or discarding the branch

#### Scenario: Working tree no longer matches its registration

- **WHEN** a task's working tree path exists but is not a usable checkout of the task branch
- **THEN** provisioning SHALL restore it from the branch, and every commit on that branch SHALL still be present afterwards

### Requirement: A task starts from the current base and then stands still

Provisioning SHALL refresh the target repository from its remote and cut the task branch from
the base branch as it stands at that moment. Once a task's branch exists it MUST NOT be moved,
rebased, or reset because the base branch advanced.

#### Scenario: Base branch advanced upstream

- **WHEN** a task is provisioned after its base branch has advanced on the remote
- **THEN** its branch SHALL be cut from the advanced base

#### Scenario: Base advances while a task is running

- **WHEN** the base branch advances after a task's branch was cut
- **THEN** the task's branch SHALL be left where it is

#### Scenario: Requested base branch does not exist

- **WHEN** a task names a base branch the remote does not have
- **THEN** provisioning SHALL fail with a message naming the missing branch, and SHALL NOT fall back to another branch

### Requirement: One shared local copy per repository

A target repository SHALL be copied locally once and shared by every task that targets it;
subsequent tasks SHALL reuse that copy rather than copying the repository again. Concurrent
provisioning requests MUST NOT corrupt the shared copy or produce more than one working tree
per task. An incomplete copy MUST NOT be usable as if it were complete.

#### Scenario: Second task on the same repository

- **WHEN** a task is provisioned for a repository that another task already uses
- **THEN** the existing local copy SHALL be reused and refreshed, not replaced by a second full copy

#### Scenario: Concurrent provisioning

- **WHEN** two provisioning requests for the same repository run at the same time
- **THEN** each task SHALL end with exactly one working tree, and the shared local copy SHALL remain usable

#### Scenario: Two tasks arrive before the first copy exists

- **WHEN** two tasks are provisioned at the same time for a repository that has no local copy yet
- **THEN** exactly one copy SHALL be made, and both tasks SHALL be provisioned from it

#### Scenario: Copying is interrupted

- **WHEN** the process dies while making the first local copy of a repository
- **THEN** no partial copy SHALL be treated as usable, and the next provisioning SHALL produce a complete one

#### Scenario: A slow copy is not mistaken for an abandoned one

- **WHEN** a copy is still progressing after the time a waiting request would otherwise reclaim the work
- **THEN** the waiting request SHALL keep waiting rather than starting a second copy

#### Scenario: Waiting request gives up

- **WHEN** a request waiting for another to finish copying exceeds its own bound
- **THEN** it SHALL fail with a diagnosable error rather than proceed without exclusive access

### Requirement: The change folder exists before the first stage

A provisioned workspace SHALL contain the task's OpenSpec change folder, marked with the
workflow schema the change is built under. In a repository that has no OpenSpec root,
provisioning SHALL create that folder and nothing else — no agent instructions, no tooling
configuration, no file anywhere else in the repository. An existing change folder MUST be left
as it is.

#### Scenario: Repository already uses OpenSpec

- **WHEN** a workspace is provisioned for a repository that has an OpenSpec root
- **THEN** the task's change folder SHALL be created and no other tracked file SHALL be added or modified

#### Scenario: Repository does not use OpenSpec

- **WHEN** a workspace is provisioned for a repository with no OpenSpec root
- **THEN** the change folder and its schema marker SHALL be created, and no agent instruction file or tooling configuration SHALL be added anywhere else in the repository

#### Scenario: Change folder already present

- **WHEN** a workspace is re-provisioned for a task whose change folder already holds artifacts
- **THEN** those artifacts SHALL be left untouched

### Requirement: Stage output is committed before the stage is reported complete

After a stage runs, its modifications SHALL be committed to the task branch before the stage is
reported complete, so that a crash at any later point cannot lose the work. The commit SHALL
identify the task, the stage, the role, the provider, and the attempt in a machine-readable
form, and its identifier SHALL be returned to the caller. A stage that modified nothing SHALL
NOT produce a commit.

#### Scenario: Stage changed files

- **WHEN** a stage finishes having modified files in the workspace
- **THEN** exactly one commit SHALL be created on the task branch, carrying the task, stage, role, provider, and attempt, and its identifier SHALL be reported

#### Scenario: Stage changed nothing

- **WHEN** a stage finishes without modifying any file
- **THEN** no commit SHALL be created and the outcome SHALL say that nothing changed

#### Scenario: Crash after committing

- **WHEN** the process dies after a stage's commit but before the orchestrator records the stage as complete
- **THEN** reopening the workspace SHALL find the work on the task branch, and committing again SHALL NOT create a duplicate or empty commit

### Requirement: Runner scratch never enters a commit

Files a run leaves behind for the orchestrator's own use — the structured result file and the
per-stage log directory — SHALL be excluded from commits. The exclusion MUST NOT modify any
file that belongs to the target repository.

#### Scenario: Result file left in the workspace

- **WHEN** a stage leaves its structured result file in the workspace root and the stage is committed
- **THEN** the commit SHALL NOT contain that file

#### Scenario: Repository ignore rules are not touched

- **WHEN** scratch exclusions are applied to a workspace
- **THEN** the repository's own ignore files SHALL be unchanged

### Requirement: Committed artifacts are indexed for display

After each stage commit, the change folder SHALL be indexed: every artifact carries its path,
its kind, the git object it was committed at, and a rendered snapshot for the UI. An artifact
removed by a stage SHALL disappear from the index. Files whose kind is outside the artifact
catalog SHALL be committed but not indexed.

#### Scenario: Artifact written by a stage

- **WHEN** a stage creates or modifies an artifact and the stage is committed
- **THEN** the index SHALL carry that artifact's path, kind, committed git object, and snapshot

#### Scenario: Artifact deleted by a stage

- **WHEN** a stage deletes an artifact and the stage is committed
- **THEN** the index SHALL no longer list that artifact

#### Scenario: File outside the artifact catalog

- **WHEN** a stage adds a file to the change folder whose kind is not in the artifact catalog
- **THEN** it SHALL be part of the commit and SHALL NOT appear in the index

### Requirement: Workspaces read from the remote and never write to it

A workspace SHALL hold exactly one credential: read access to its target repository. No
workspace operation may write to the remote. Repository access MUST be non-interactive: a
missing, expired, or rejected credential SHALL fail with a message naming the setting at fault
instead of waiting for input.

#### Scenario: Write to the remote attempted

- **WHEN** any workspace operation would write to the remote repository
- **THEN** it SHALL be refused, because Phase 1 workspaces hold no write credential

#### Scenario: Credential missing or rejected

- **WHEN** the configured repository credential is absent or refused by the remote
- **THEN** provisioning SHALL fail promptly with a message naming the setting, and SHALL NOT block waiting for interactive input

### Requirement: Release destroys the working tree and keeps the history

Releasing a workspace SHALL remove its working tree while keeping the task branch and its
commits resolvable. Release SHALL be refused while the task is still active, and releasing an
already-released workspace SHALL succeed without effect.

#### Scenario: Task reaches a terminal state

- **WHEN** a task is archived or cancelled and its workspace is released
- **THEN** the working tree SHALL be removed and the task branch with all its commits SHALL still be resolvable

#### Scenario: Release of an active task

- **WHEN** release is requested for a task that is not in a terminal state
- **THEN** it SHALL be refused and the working tree SHALL be left intact

#### Scenario: Release repeated

- **WHEN** release is requested for a workspace that was already released
- **THEN** it SHALL succeed without changing anything

### Requirement: A failed attempt's uncommitted changes can be discarded

A workspace SHALL support discarding everything uncommitted, restoring the working tree to the
most recent stage commit on the task branch. Discarding MUST remove files an attempt created as
well as revert files it modified, MUST NOT alter any commit already on the branch, and MUST leave
the runner scratch intact, because the failed attempt's log and result are the evidence a human
is shown.

#### Scenario: Half-written artifacts from a failed attempt

- **WHEN** an attempt has modified tracked artifacts and created new ones, and the workspace is discarded
- **THEN** the working tree SHALL match the last stage commit and the created files SHALL be gone

#### Scenario: Committed work survives

- **WHEN** a workspace is discarded
- **THEN** every commit on the task branch SHALL still be present

#### Scenario: Runner scratch survives

- **WHEN** a workspace is discarded after a failed attempt that wrote a log and a result
- **THEN** both SHALL still be readable

#### Scenario: Nothing to discard

- **WHEN** a workspace is discarded while its working tree is already clean
- **THEN** the operation SHALL succeed and change nothing
