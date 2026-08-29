## RENAMED Requirements

- FROM: `### Requirement: REQ-708 — Committed artifacts are indexed for display`
- TO: `### Requirement: REQ-708 — A stage's artifacts are indexed for display`

## ADDED Requirements

### Requirement: REQ-712 — A workspace is given back the artifacts it does not carry

Where a task's change folder is not part of the target repository, the store SHALL be authoritative
for it: every artifact on record SHALL be present in the workspace, at its recorded path and with
its recorded content, before any stage or conversation response runs. This SHALL hold for a
workspace created fresh, one repaired after its working tree was lost, a disposable conversation
checkout, and a tree returned to a commit after a discarded attempt.

An artifact the store carries MUST NOT be missing from a stage's context because a working tree was
rebuilt, and an artifact a discarded attempt wrote MUST NOT survive into the next one. Where the
change folder is part of the repository, git already provides both and nothing is restored.

#### Scenario: AC-746 — A workspace rebuilt from nothing

- **WHEN** a task whose change folder the repository does not carry is provisioned into a workspace without it
- **THEN** every artifact on record SHALL be restored into the change folder before the stage runs

#### Scenario: AC-747 — A conversation checkout

- **WHEN** a disposable conversation workspace is provisioned for such a task
- **THEN** it SHALL carry the same artifacts as the task's own workspace

#### Scenario: AC-748 — A discarded attempt

- **WHEN** an incomplete attempt is discarded for such a task
- **THEN** the change folder SHALL be returned to what the store records, and what the discarded attempt wrote SHALL NOT remain

## MODIFIED Requirements

### Requirement: REQ-705 — The change folder exists before the first stage

A provisioned workspace SHALL contain the task's change folder, marked with the workflow schema the
change is built under, before any stage runs. Where the repository's profile in force is an OpenSpec
suite, that folder SHALL be created in the repository's tree and provisioning SHALL create nothing
else there — no agent instructions, no tooling configuration, no file anywhere else in the
repository. Under every other profile, provisioning SHALL add nothing to the repository's tree at
all, and the change folder SHALL be created where commits do not reach it (REQ-707, REQ-1707).

Which of the two a task uses SHALL be fixed when the task is first provisioned and SHALL NOT change
for the life of the task. An existing change folder MUST be left as it is.

#### Scenario: AC-715 — Repository already uses OpenSpec

- **WHEN** a workspace is provisioned for a repository that has an OpenSpec root
- **THEN** the task's change folder SHALL be created and no other tracked file SHALL be added or modified

#### Scenario: AC-716 — Repository does not use OpenSpec

- **WHEN** a workspace is provisioned for a repository with no OpenSpec root
- **THEN** no file SHALL be added anywhere in the repository's tree, and the task's change folder SHALL be created where commits do not reach it

#### Scenario: AC-717 — Change folder already present

- **WHEN** a workspace is re-provisioned for a task whose change folder already holds artifacts
- **THEN** those artifacts SHALL be left untouched

#### Scenario: AC-743 — The profile changes after provisioning

- **WHEN** a repository's profile changes after a task has been provisioned under the other one
- **THEN** that task's change folder SHALL stay where it was created

### Requirement: REQ-708 — A stage's artifacts are indexed for display

After each stage, the task's change folder SHALL be indexed: every artifact carries its path, its
kind, and a rendered snapshot, together with the git object it was committed at where the folder is
part of the repository. An artifact removed by a stage SHALL disappear from the index. Files whose
kind is outside the artifact catalog SHALL NOT be indexed.

Indexing SHALL NOT be conditional on the stage having produced a commit. A stage whose only output
is artifacts the repository does not carry produces no commit, and its artifacts SHALL be indexed
all the same — otherwise the one store those artifacts have is the one never written.

#### Scenario: AC-723 — Artifact written by a stage

- **WHEN** a stage creates or modifies an artifact and the stage is committed
- **THEN** the index SHALL carry that artifact's path, kind, committed git object, and snapshot

#### Scenario: AC-724 — Artifact deleted by a stage

- **WHEN** a stage deletes an artifact
- **THEN** the index SHALL no longer list that artifact

#### Scenario: AC-725 — File outside the artifact catalog

- **WHEN** a stage adds a file to the change folder whose kind is not in the artifact catalog
- **THEN** it SHALL be kept with the stage's other output and SHALL NOT appear in the index

#### Scenario: AC-744 — A stage that produced no commit

- **WHEN** a stage's only output is artifacts in a change folder the repository does not carry
- **THEN** those artifacts SHALL be indexed although the stage made no commit

#### Scenario: AC-745 — An artifact the repository does not carry

- **WHEN** an artifact outside the repository's tree is indexed
- **THEN** it SHALL be recorded with no git object and with its content stored whole
