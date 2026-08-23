## Why

Launching a task asks the owner for four fields. Three of them the system can determine better
than the owner can type them, and one of them decides nothing at all:

- **The task type decides nothing.** `feature` and `bugfix` map to the same pipeline definition in
  both profiles (`PIPELINE_CATALOG` and `PIPELINE_PROFILE_CATALOG`). The owner is asked to
  classify the work before anyone has read the repository, and the answer changes no behaviour.
- **The title is a guess about unplanned work.** Planning reads the repository and can name the
  work properly; today the owner's guess is what sticks for the life of the task.
- **The base branch is `main` in almost every launch**, and is a field for the rare case.
- **The repository is the only field that must be right before anything runs**, because the
  planning stage runs inside a clone of it and REQ-1301 requires it to read that clone first.

The request — the one input the pipeline actually works from — is the fourth field down the form
and is optional (REQ-903). The form is backwards: what matters is optional, what does not matter
is mandatory.

`planner-decomposition` already established the pattern this change follows. Planning reads the
repository and declares the shape of the work as structured data; the engine bounds that
declaration rather than deriving it. Naming the work and classifying it are the same kind of
judgement, made by the same role at the same moment, and they are still the owner's guess taken
before the repository was opened.

This is Phase 6-era polish of an existing surface, not a roadmap phase of its own: it changes how
a task is started, not what kinds of work exist.

## What Changes

- **The launch screen becomes one field.** A request textarea and a launch button. The per-role
  model override and an explicit base branch move behind a single collapsed `Advanced`
  disclosure. The stale "The task starts in draft" note goes — creating has been launching since
  `draft` stopped being dispatched.
- **Intake resolves the repository itself, and asks only when it cannot.** In order: a repository
  URL written in the request text; a repository SpecMate already knows, named in the text; the
  default-repository setting. Resolution is mechanical — no model reads the request at intake.
- **An unresolved repository is a rejected intake, not a new mechanism.** The response names
  `repoUrl` as the offending field and carries the known repositories as candidates, so the screen
  renders a choice under the input with the owner's text preserved (REQ-1001, AC-906).
- **A new read lists the repositories SpecMate knows**, most recently used first, with the default
  marked — used both by the launch screen's choice and by Settings, which gains the default.
- **The title starts as a placeholder and becomes what planning declared.** Intake derives the
  placeholder mechanically from the first line of the request. Planning declares `title` and
  `type` in the same `plan` block that already carries `size` and `prerequisites`; the task is
  renamed and the rename is recorded in the event log. A completed planning stage that declares
  no title fails the attempt exactly as a missing size does (AC-1317).
- **The slug stays what intake made it.** It names the task branch (`taskBranch`) and the change
  folder committed inside the repository (`changeDir`), both of which exist from the first
  planning run. The rename changes the title only; nothing moves on disk or on the remote.
- **The base branch is the repository's default unless the owner names one.** A task may be
  launched with no base branch; provisioning resolves the repository's default from the mirror and
  records it on the task, so publish opens its PR against a real branch. Without this, dropping
  the field would fail provisioning outright for any repository whose default is not `main`
  (AC-708).
- **BREAKING (task surface).** `POST /tasks` requires the request text and no longer requires a
  title or a type. A title-only launch — accepted today, with the title standing as the ask —
  is rejected.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `task-surface`: intake takes the owner's request as its only required input, resolves the
  target repository itself, and rejects with the known repositories named when it cannot; a new
  read lists those repositories.
- `operator-ui`: the new-task screen becomes one field plus a collapsed advanced disclosure, shows
  the repository choice only when intake could not resolve one, and Settings gains the default
  repository.
- `kickoff-brief`: the plan declaration carries the task's title and type alongside its size, and
  the mechanical check that fails a stage missing a size fails one missing a title.
- `persistence`: a task's title may be superseded by what planning declared, and its base branch
  may be unset until provisioning resolves the repository's default.
- `workspace-lifecycle`: a task that names no base branch is cut from the repository's default
  branch, and the branch that was resolved is recorded on the task.

## Impact

- `packages/core/src/plan.ts`: `title` and `type` on `PlanShape`.
- `packages/core/src/result.ts`: the plan check covers the declared title.
- `packages/db/src/schema.ts` + migration: `tasks.base_branch` becomes nullable ("the
  repository's default, not yet resolved"); the default-repository setting is a row in
  `app_settings`, not a column.
- `apps/api/src/app.ts`: `CreateTask` loosened to the request plus optional overrides; repository
  resolution and the candidate-bearing rejection; the placeholder title and the slug derived from
  the request; `GET /repos`; the default-repository setting endpoints.
- `apps/orchestrator/src/store.ts`: `createTask` accepts an absent base branch; `recordPlanShape`
  applies the declared title and type and emits the rename event.
- `packages/workspace/src/mirror.ts` + `manager.ts`: resolve `origin/HEAD` when a task names no
  base branch; the resolved branch travels back to the caller.
- `roles/planner.md`: the `plan` block gains `title` and `type`, and what each is for.
- `apps/web/src/screens/new-task-screen.tsx`: rewritten around the single field.
- `apps/web/src/screens/settings-screen.tsx`: the default repository.

## Non-goals

- **No conversational intake before the task exists.** A pre-task chat was considered and
  rejected: it makes `repo_url` nullable through every engine path that reads it, and conversation
  workspaces are cut from the task's repository — so the one card the owner would want to discuss,
  "which repository?", is exactly the card that could not carry a discussion. When the repository
  is known, every question already has a home in the task thread.
- **No model reading the request at intake.** Repository resolution is a URL match, a name match,
  and a default. Judgement about what the request *means* stays with planning, which has read the
  repository — that is the whole point of REQ-1301.
- **No removal of the task type.** It is declared rather than asked, and remains a label. Deleting
  it would touch the pipeline catalog, the database enum, the API and the UI to no visible benefit,
  and would foreclose pipelines that diverge by type later.
- **No re-slugging after the rename.** The branch and the change folder keep the name intake gave
  them. Moving a branch under a running task to make it prettier is not a trade this change makes.
- **No repository registry.** Known repositories are derived from the tasks that ran against them.
  Adding, renaming, or retiring repositories as first-class records is a separate change.
- **No parsing of anything but the repository out of the request.** A request that says "on
  `release/2.0`" still launches against the default branch; the base branch is an advanced field.
- **No back-fill.** Existing tasks keep the titles and types they were launched with.
