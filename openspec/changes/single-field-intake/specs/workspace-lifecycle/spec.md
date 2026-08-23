## MODIFIED Requirements

### Requirement: REQ-703 — A task starts from the current base and then stands still

Provisioning SHALL refresh the target repository from its remote and cut the task branch from
the base branch as it stands at that moment. A task that names no base branch of its own SHALL be
cut from the repository's default branch as the remote reports it, and the branch actually used
SHALL be recorded on the task, so every later reader — the diff between base and branch, the pull
request opened at publish — works from a concrete branch rather than re-deriving one. A default
branch the remote does not report MUST fail provisioning naming the repository; provisioning MUST
NOT fall back to a conventional name. Once a task's branch exists it MUST NOT be moved, rebased,
or reset because the base branch advanced.

#### Scenario: AC-706 — Base branch advanced upstream

- **WHEN** a task is provisioned after its base branch has advanced on the remote
- **THEN** its branch SHALL be cut from the advanced base

#### Scenario: AC-707 — Base advances while a task is running

- **WHEN** the base branch advances after a task's branch was cut
- **THEN** the task's branch SHALL be left where it is

#### Scenario: AC-708 — Requested base branch does not exist

- **WHEN** a task names a base branch the remote does not have
- **THEN** provisioning SHALL fail with a message naming the missing branch, and SHALL NOT fall back to another branch

#### Scenario: AC-737 — The task names no base branch

- **WHEN** a task carrying no base branch of its own is provisioned against a repository whose default branch is not `main`
- **THEN** its branch SHALL be cut from that default branch, and the task SHALL afterwards report that branch as the one it runs against

#### Scenario: AC-738 — The remote reports no default branch

- **WHEN** a task carrying no base branch of its own is provisioned against a repository whose remote reports no default branch
- **THEN** provisioning SHALL fail naming the repository, and SHALL NOT cut the branch from a conventionally named one
