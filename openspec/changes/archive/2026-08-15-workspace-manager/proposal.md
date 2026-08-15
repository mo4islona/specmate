## Why

Phase 1 of `docs/plan.md` turns the skeleton into a walking pipeline, and every stage of that
pipeline needs somewhere to run: an isolated checkout of the target repository, on a branch that
belongs to the task, with the OpenSpec change folder the agents read and write. Nothing else in
Phase 1 can be built first — the runner needs a workspace path to mount, and the orchestrator
needs the guarantee that a stage's output is durable before it advances the task.

The guarantee is the point. Agents produce artifacts as files; if a stage's files are still
uncommitted when the process dies, the work is gone and the task restarts from a stale change
folder. Committing after every stage makes the git branch the recovery boundary, which is what
lets the orchestrator be a plain restartable loop rather than a transactional engine.

## What Changes

- A workspace manager that provisions, repairs, and releases one working tree per task: a shared
  bare mirror per target repository, a `task/<slug>` branch cut from the task's base branch, and
  a git worktree checked out from it.
- Provisioning is idempotent and self-repairing: asking twice returns the same workspace, and a
  process that died half-way through provisioning is finished rather than restarted.
- Scaffolding of `openspec/changes/<slug>/` inside the workspace. A target repository with no
  OpenSpec root gets the change folder and nothing else — SpecMate does not install its own
  tooling into someone else's repository.
- A commit after every stage, on the task branch, carrying machine-readable trailers that name
  the task, stage, role, provider, and attempt. A stage that changed nothing produces no commit.
- Runner scratch — `RESULT.json` and the per-stage log directory — excluded from commits through
  the worktree's local exclude file, so the target repository's own `.gitignore` is never edited.
- Indexing of the change folder into the `artifacts` table after each commit: path, kind, git
  object, and a rendered snapshot for the UI, with git remaining the source of truth.
- Release on a terminal task: the worktree is removed, the branch survives in the mirror, and
  releasing a task that is still running is refused.
- Workspaces carry exactly one credential — a read-only key for the target repository — and git
  is invoked non-interactively, so a missing or rejected credential fails loudly instead of
  hanging on a prompt.

## Capabilities

### New Capabilities
- `workspace-lifecycle`: how a task acquires an isolated checkout, how stage output becomes
  durable, and when a workspace is repaired, reused, or destroyed.

### Modified Capabilities
<!-- None: no existing capability's requirements change. -->

## Impact

- New: `packages/workspace` — mirror cache, worktree provisioning, change-folder scaffolding,
  stage commits, artifact indexing.
- `apps/orchestrator` gains the workspace configuration (`WORKSPACE_ROOT`, git identity, the
  read-only key path) and a `git` binary in its image; Compose gains a workspaces volume.
- The `artifacts` table gets its first writer. No schema change: the table already exists and
  paths are derived from the task slug, so no new columns are needed.
- `.env.example` documents the new settings.

## Non-goals

- No push, no remote branches, no pull requests. Phase 1 keeps the work local; publishing is
  Phase 5, PR tracking is Phase 3.
- No stage execution: assembling prompts, invoking a provider CLI, and parsing `RESULT.json`
  belong to the runner change that follows this one.
- No state transitions, retries, or caps — the orchestrator loop is its own change.
- No `openspec init` in target repositories, no edits outside the change folder except the
  worktree's local exclude file.
- No disk quotas, retention sweeps, or garbage collection of mirrors (Phase 6 hardening).
- No multi-host workspaces: one server, one filesystem, one orchestrator process.
