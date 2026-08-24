## MODIFIED Requirements

### Requirement: REQ-705 — The change folder exists before the first stage

A provisioned workspace SHALL contain the task's OpenSpec change folder, marked with the
workflow schema the change is built under. In a repository that has no OpenSpec root,
provisioning SHALL create that folder and nothing else — no agent instructions, no tooling
configuration, no file anywhere else in the repository. An existing change folder MUST be left
as it is.

The folder SHALL be named by what the task's planning declared the change to be called. Until a
declaration exists, the task's slug SHALL stand as a provisional name, and provisioning SHALL
converge a folder standing under that provisional name onto the declared one once there is one.
The convergence SHALL happen before the declaring stage's own output is committed, so that no
commit ever carries the provisional name; a folder already committed under a name MUST NOT be
renamed afterwards. Where the declared name is already taken in the repository by anything that
is not this task's own folder, the task's own identity SHALL disambiguate it rather than the two
sharing a folder.

#### Scenario: AC-715 — Repository already uses OpenSpec

- **WHEN** a workspace is provisioned for a repository that has an OpenSpec root
- **THEN** the task's change folder SHALL be created and no other tracked file SHALL be added or modified

#### Scenario: AC-716 — Repository does not use OpenSpec

- **WHEN** a workspace is provisioned for a repository with no OpenSpec root
- **THEN** the change folder and its schema marker SHALL be created, and no agent instruction file or tooling configuration SHALL be added anywhere else in the repository

#### Scenario: AC-717 — Change folder already present

- **WHEN** a workspace is re-provisioned for a task whose change folder already holds artifacts
- **THEN** those artifacts SHALL be left untouched

#### Scenario: AC-739 — The folder takes the declared name

- **WHEN** a workspace is provisioned for a task whose planning has declared what the change is called
- **THEN** the change folder SHALL be that name, and no folder under the provisional name SHALL remain

#### Scenario: AC-740 — Nothing declared yet

- **WHEN** a workspace is provisioned for a task whose planning has not run
- **THEN** the change folder SHALL be the task's slug, and the task SHALL be able to run its planning stage against it

#### Scenario: AC-741 — Converging before the first commit

- **WHEN** the stage that declared the change's name is accepted
- **THEN** the folder SHALL carry the declared name before that stage's output is committed, and the commit SHALL contain no path under the provisional name

#### Scenario: AC-742 — The declared name is already taken

- **WHEN** the declared name matches a change folder in the repository that is not this task's
- **THEN** the task's folder SHALL take a name disambiguated by the task's own identity, and the existing folder SHALL be left untouched
