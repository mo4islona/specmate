## ADDED Requirements

### Requirement: REQ-1023 — Archived and cancelled tasks can be deleted permanently

The API SHALL expose permanent deletion of a task and SHALL accept it only while the stored task
is archived or cancelled. Eligibility MUST be decided from the stored state when deletion is
attempted, never from a state supplied by the caller. An active or failed task SHALL be rejected
as a conflict and MUST remain unchanged. Before removing the database record, the service SHALL
release the task's workspace under REQ-710; if release fails, deletion SHALL fail and the task
record MUST remain. Removing the task SHALL remove its subordinate records under REQ-310 and
SHALL NOT rewrite commits, branches, or pull requests in the remote repository. A successful
deletion SHALL return with no body; every later task-list or task-detail read SHALL behave as if
that task does not exist.

#### Scenario: AC-1081 — Archived task is deleted

- **WHEN** permanent deletion is requested for an archived task and its workspace release succeeds
- **THEN** the task and its subordinate records SHALL be removed and the response SHALL succeed with no body

#### Scenario: AC-1082 — Recoverable task is rejected

- **WHEN** permanent deletion is requested for an active or failed task
- **THEN** the API SHALL return a conflict and SHALL leave the task and its subordinate records unchanged

#### Scenario: AC-1083 — Workspace release fails before deletion

- **WHEN** permanent deletion is requested for an eligible task but its workspace cannot be released
- **THEN** the request SHALL fail and the task record SHALL remain readable

#### Scenario: AC-1084 — Deleted task is absent from reads

- **WHEN** a task has been deleted successfully
- **THEN** it SHALL be absent from the task list and a detail read for its identifier SHALL return not found

## MODIFIED Requirements

### Requirement: REQ-1008 — Operator feedback capture

The API SHALL accept a free-form operator comment on a task and append a corresponding event so
watching clients see it. Where the task's state has a pipeline node the comment is addressed to
— the node running now, or, when nothing is running and the pipeline has more to do, the node
that runs next — it SHALL be stored as guidance targeted at that node, so that node's next run
receives it through its ledger; otherwise it SHALL be stored as commentary of the `comment`
kind. A comment naming one of the task's stages SHALL reference that stage and carry the role
and provider it corrects. The API MUST NOT ask the caller which node to target: the target is
derived from the task's own state, and a caller-supplied stage pins the comment to that stage's
record without changing what any run reads. An empty comment MUST be rejected. Capture MUST NOT
depend on any consumer existing — the Retro agent arrives later.

#### Scenario: AC-1016 — Comment on a task

- **WHEN** the operator posts a comment on a task
- **THEN** a feedback record SHALL be written and an event SHALL be appended to the task's log

#### Scenario: AC-1017 — Comment pinned to a stage

- **WHEN** the operator posts a comment naming one of the task's stages
- **THEN** the feedback record SHALL reference that stage and carry the role and provider it corrects

#### Scenario: AC-1018 — Empty comment

- **WHEN** a comment with no content is posted
- **THEN** it SHALL be rejected and nothing SHALL be written

#### Scenario: AC-1046 — A comment at a running node becomes its guidance

- **WHEN** the operator comments on a task while one of its nodes is running
- **THEN** the stored feedback SHALL be guidance targeted at that node, and the next run of that node SHALL receive it in its ledger
