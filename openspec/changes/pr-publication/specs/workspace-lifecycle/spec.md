## MODIFIED Requirements

### Requirement: REQ-709 — Workspaces read from the remote, and only publication ever writes to it

A workspace's git operations SHALL authenticate through one configured GitHub credential, capable
of both read and write. No workspace operation — clone, fetch, worktree provisioning, or
stage-output commit — may itself write to the remote; writing is exclusively the publish path's
responsibility. This credential MUST NOT be present in a stage's runner container: workspace
operations run entirely within the orchestrator process, before a runner container for that stage
is even started. Repository access MUST be non-interactive: a missing, expired, or rejected
credential SHALL fail with a message naming the setting at fault instead of waiting for input.

#### Scenario: AC-726 — Write to the remote attempted through a workspace operation

- **WHEN** any workspace operation would write to the remote repository
- **THEN** it SHALL be refused — writing is exclusively the publish path's responsibility, not a workspace operation's

#### Scenario: AC-727 — Credential missing or rejected

- **WHEN** the configured repository credential is absent or refused by the remote
- **THEN** provisioning SHALL fail promptly with a message naming the setting, and SHALL NOT block waiting for interactive input

#### Scenario: AC-736 — Credential absent from a runner

- **WHEN** a stage runs inside its runner container
- **THEN** the git credential SHALL NOT be present in that container's environment or mounted filesystem, because workspace operations never run inside a runner
