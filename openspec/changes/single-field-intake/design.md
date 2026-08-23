## Context

See proposal.md — Why. The constraints that shape the approach are all pre-existing:

- **Planning runs inside the repository.** A stage is dispatched into a provisioned workspace cut
  from `task.repoUrl`, and REQ-1301 requires the planner to read that clone before writing. The
  one field this change wants to infer is the one field no agent in the system can be asked about,
  because every agent already lives inside the answer.
- **Creating is launching.** `draft` is a reserved state the poll never dispatches; a created task
  starts at its pipeline's entry node. There is no pause between "the task exists" and "an agent is
  running against a repository".
- **The slug is not decoration.** It names the task branch, the worktree path, and the change
  folder committed inside the repository, all of which exist from the first planning run.
- **Planning already declares structured data.** `PlanShape` carries the size that selects the
  pipeline profile and the prerequisites the split creates; a planning result missing it fails the
  attempt (REQ-1306). Declaring two more fields is an extension of a mechanism, not a new one.

## Goals / Non-Goals

**Goals:**

- One required input on the launch screen, and no question asked that the system can answer.
- Repository resolution that is explainable in one sentence and produces the same task for the
  same request every time.
- The naming of the work made by the role that has read the repository, without moving anything
  that already exists on disk or on the remote.

**Non-Goals:**

- Any pre-task conversation surface (see proposal.md — Non-goals).
- Inferring anything but the repository from the request text.
- Changing what the planner does with the request once the task exists.

## Decisions

### Resolution is mechanical, and ambiguity rejects rather than guesses

Order: an explicit `repoUrl` on the create request; the first repository URL found in the request
text; a known repository whose short name appears in the request text; the default-repository
setting. Known repositories come from the tasks that ran against them — the same grouping the
coverage screen already does — and comparison uses `normalizeRemote`, which already folds
`git@host:org/repo.git` and `https://host/org/repo` onto one spelling.

Name matching compares the last path segment of the normalized remote against the request text as
a whole word, case-insensitively. Two known repositories matching is a rejection, not a coin flip.

*Alternative — a model reads the request at intake.* Rejected: it puts a model call between a
button press and a database row, makes the branch name non-deterministic for the same request, and
buys nothing the planner cannot do better once the repository is known. The judgement worth paying
a model for needs the repository open, which is exactly what intake does not have.

*Alternative — a repository registry with explicit entries.* Rejected for now: the derived list is
free and always current, and a registry is a separate change with its own lifecycle (renames,
retirement, credentials per repository).

### An unresolved repository is a rejected intake, not a new state

The failure rides the existing validation envelope: the response names `repoUrl` among its fields
and carries the candidates alongside them, so the screen shows a choice under the preserved
request. This costs one optional member on the error body and one on the client's
`ApiRequestError`; it costs no new endpoint, no new task state, and no cleanup path for tasks that
were started and abandoned before they had a repository.

*Alternative — create the task in `draft` and park it on a blocking decision.* Rejected. It makes
`repo_url` nullable through every engine path that reads it, needs `draft` to become dispatchable,
needs a story for abandoned drafts, and — decisively — conversation workspaces are cut from the
task's repository, so the one card the owner would want to talk to is the one card that could not
carry a conversation.

### The title is a placeholder; the slug it produces is final

Intake derives the title from the first line of the request (trimmed, bounded), and the slug from
that title as it already does. `slugify` collapses anything outside `[a-z0-9]` and falls back to
`task`, so a request written in a non-Latin script degrades to today's neutral `task-<suffix>`
branch name instead of needing a special case.

The rename that planning performs changes the title only. Moving a branch and a committed change
folder under a running task to make them match a prettier name is not a trade worth making, so the
branch keeps the name intake gave it and the two are allowed to diverge.

### The declared title and type ride the existing plan declaration

`PlanShape` gains `title` and `type`; the check that already fails a planning attempt without a
size fails one without a title; `recordPlanShape` applies them in the same transaction that
records the size and appends a `task.renamed` event. The events table types are free text, so this
needs no migration and the existing stream carries the rename to any watching client.

*Alternative — a separate structured field, or a second stage.* Rejected: one declaration, one
completeness check, one place in the planner prompt.

### An unset base branch means "the repository's default"

`tasks.base_branch` becomes nullable. Provisioning resolves the default from the mirror's
`origin/HEAD` when the task carries none, and writes the resolved branch back onto the task, so
`publish` and the diff view keep reading a concrete branch rather than re-deriving one.

*Alternative — keep the `main` default and drop the field.* Rejected: any repository whose default
is `master` would fail provisioning outright (AC-708), and the owner would have no field left to
correct it with.

*Alternative — resolve at intake with `ls-remote`.* Rejected: the API holds no git credentials —
the orchestrator and the workspace service own that — and it would block the create call on a
network round-trip to the forge.

## Risks / Trade-offs

- **A request that mentions a second repository in passing resolves to the wrong one.** → Matching
  is on the repository's own short name as a whole word; two matches reject rather than choose; and
  the created task shows the repository it resolved to on the very first screen the owner lands on,
  so a wrong inference is visible before planning finishes.
- **A fresh install knows no repositories.** → The first launch must carry a URL in its text, or
  the owner sets a default in Settings, which accepts a repository nothing has run against yet
  (REQ-1017). Without that allowance the feature would be unusable exactly once — on day one.
- **A planning attempt in flight during the deploy returns a declaration with no title.** → It
  fails that attempt and retries under the new prompt; stage attempts are idempotent (REQ-304). The
  prompt and the check ship together, so the window is one attempt wide.
- **The branch name and the task title diverge.** → Accepted deliberately. The branch is a machine
  name; the title is for humans. The task view shows both.
- **Losing the type as an intake field removes a signal the owner could set deliberately.** → It
  set nothing: both types select the same pipeline. If pipelines ever diverge by type, the declared
  value is already the one the engine reads.

## Migration Plan

1. Migration making `tasks.base_branch` nullable. Existing rows keep the branch they were created
   with; nothing back-fills, and no existing task changes behaviour.
2. Ship the API, the planner prompt, and the web client together — the screen depends on the
   loosened intake, and the required title in the declaration depends on the prompt that emits it.
3. Rollback is the previous release plus leaving the column nullable: the old intake always sends a
   base branch, so a nullable column is compatible with it in both directions.

## Open Questions

- A repository renamed on its forge appears twice in the derived list — once under each remote
  spelling — until the old tasks are archived. Whether the list should fold those together, and on
  what evidence, can be answered after it has happened once; it changes no requirement here.
