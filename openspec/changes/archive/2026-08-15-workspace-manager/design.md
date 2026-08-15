## Context

See proposal.md — Why. The constraints that shape the approach:

- One server, one filesystem, one orchestrator process (Phase 1). Workspaces are local
  directories, not a distributed store.
- Runners are containers that mount a workspace path (`StageJob.workspacePath`, `changeDir` in
  `packages/core/src/provider.ts`), so a workspace must be a plain directory on disk.
- The `tasks` table has no workspace columns and this change adds none: every path is derived
  from the task slug, which is already unique.
- The `artifacts` table exists and is unused. This change is its first writer.
- Target repositories are foreign property. SpecMate may add its change folder and read
  everything; it may not install tooling, rewrite ignore files, or push.

## Goals / Non-Goals

**Goals:**
- Provisioning that can be called from a restarted process in any prior state and converges.
- A crash boundary per stage: once a stage's commit exists, the work survives anything.
- Cheap repeat tasks against the same repository: one local copy, incremental fetches.
- Testable without network or credentials.

**Non-Goals:**
- Distributed or multi-host workspaces; any locking beyond one machine.
- Garbage collection of mirrors, disk quotas, retention (Phase 6).
- Anything that writes to a remote (Phase 5).

## Decisions

### Bare mirror per repository + a git worktree per task

`<root>/mirrors/<repo-key>.git` is a bare mirror shared by every task targeting that repository;
`<root>/tasks/<slug>` is a worktree of it on branch `task/<slug>`.

Alternatives: a full clone per task (re-downloads the repository per task, and N clones of a
large repository is the dominant disk cost); a container volume per task (opaque to the host,
harder to inspect and to test). Worktrees give branch isolation with one object store, and
`git worktree list` makes the on-disk state introspectable, which is what makes repair cheap.

`<repo-key>` is the normalized remote (host + path, non-alphanumerics folded to `-`) plus a
short hash of the original URL, so two remotes that normalize alike cannot collide.

### Deterministic paths instead of a workspace table

Both paths are pure functions of the task slug and repo URL. Idempotency then needs no
bookkeeping: provisioning inspects the filesystem and the mirror's refs, and creates only what
is missing. A crash between any two steps leaves a state the next call can finish. A
`workspaces` table would need its own crash-consistency story to say the same thing.

### The git CLI, invoked non-interactively

Provisioning shells out to `git` rather than using a JavaScript git implementation: worktrees,
partial fetch, and credential handling are exactly the parts such libraries do worst.

Every invocation runs with a fixed environment: `GIT_TERMINAL_PROMPT=0`, `GIT_SSH_COMMAND`
carrying the configured key with `BatchMode=yes` and `IdentitiesOnly=yes`, and
`GIT_CONFIG_GLOBAL=/dev/null` so the server's own git config cannot change behaviour. Author and
committer identity are passed per invocation with `-c user.name` / `-c user.email` rather than
written into any config file. Result: a missing or rejected key fails in seconds with a
diagnosable error instead of hanging a stage on a password prompt.

### Locking: an in-process mutex plus an on-disk lock directory

Fetches and worktree creation for one mirror are serialized by a keyed in-process mutex — which
covers the real case, since only the orchestrator provisions, and two tasks arriving together
means the second simply awaits the first's promise without touching the disk. Cross-process
safety (a second orchestrator, a manual command) is a lock directory created with `mkdir` next
to the mirror: `mkdir` either creates or fails, which is the whole mutual-exclusion primitive.

Postgres advisory locks were the alternative. They would mean holding a pooled connection open
across a multi-second `git fetch`, and they buy cross-host safety that Phase 1 does not have.

The interesting case is the cold start — two tasks for a repository that has no mirror yet —
because there the loser of the race must not clone on top of the winner, and a clone killed
half-way must not be mistaken for a usable mirror. Three rules cover it:

- **The mirror path appears only when the mirror is complete.** Cloning writes to a temporary
  sibling directory and is published with a single `rename` once git exits successfully. An
  interrupted clone leaves a temp directory, which is swept, and never a half-populated mirror.
- **Whoever waits re-checks before acting.** After acquiring the lock, provisioning tests for
  the mirror again; finding one now, it fetches instead of cloning. The check before the lock is
  only an optimisation, never the decision.
- **Takeover follows a heartbeat, not a deadline.** The holder refreshes the lock's timestamp
  while it works, and a waiter may take the lock over only once that timestamp goes stale. A
  fixed timeout would be wrong precisely for the case that needs the lock most — the first clone
  of a large repository, which is slow but perfectly alive.

A waiter that neither acquires nor inherits the lock within its bound fails the stage with a
diagnosable error. Proceeding without the lock is never an option; the orchestrator retries.

### Scratch exclusion in the mirror's `info/exclude`

`RESULT.json` and the per-stage log directory are excluded through the shared repository's
`info/exclude`, which git honours for all its worktrees and which is not part of the repository's
tree. The obvious alternative — appending to the repository's `.gitignore` — would put SpecMate's
private concerns into someone else's tracked file, and would show up in the diff a human reviews.

### Commit per stage, with trailers

The workspace stages everything (`git add -A`, honouring excludes) and commits only when
`git status --porcelain` reports changes, so "nothing changed" is a first-class outcome rather
than an error code to interpret. The message is a conventional-commit subject plus trailers:

```
chore(<slug>): <role> stage output

Task: <slug>
Stage: <stage-id>
Role: <role>
Provider: <provider>
Attempt: <n>
```

Trailers keep the commit greppable by the orchestrator and the UI without a side table, and the
subject stays readable in the eventual PR.

### Indexing re-scans the change folder

After a commit the whole change folder is re-scanned rather than diffed: it holds a handful of
markdown files, a scan is trivially correct, and the same routine backfills the index after any
repair. Rows for files that disappeared are deleted, so the index cannot outlive its files.

Artifact kind is inferred from the path (`proposal.md`, `design.md`, `tasks.md`, `specs/**` →
`spec`, `review*`, `verification.md`, `summary.md`, `decisions.md`). Files that match nothing are
committed but not indexed — the catalog is a closed enum in `packages/core`, and inventing a kind
for a stray file would corrupt it. The snapshot is the file's text truncated at 256 KB; git holds
the truth, the snapshot only feeds the UI.

### Package boundary

New `packages/workspace`, depending on `@specmate/core` (artifact kinds) and `@specmate/db`
(the artifact index, and the task status that gates release). It takes its configuration as an
explicit options object; the orchestrator parses the environment and passes it in, so tests
construct a manager against a temporary directory with no environment at all.

### Tests run against `file://` origins

Fixtures create a real origin repository in a temp directory and use its `file://` URL. That
exercises the actual git paths — clone, fetch, worktree add, commit — with no network and no
credentials, so the suite runs in CI unchanged.

## Risks / Trade-offs

- **First task on a large repository blocks on a full mirror fetch** → subsequent tasks pay only
  an incremental fetch; the initial cost is bounded and visible as stage duration. Partial-clone
  filters are a later optimization, not needed while repositories are our own.
- **`git add -A` commits whatever the agent left behind** (build output, dependency
  directories) → the repository's own ignore rules plus our excludes cover the normal cases, and
  the commit's diff is human-reviewed before anything merges. A per-stage size ceiling is Phase 6.
- **A crashed process leaves a stale lock directory** → takeover after a timeout; the worst case
  is one duplicated fetch, which git tolerates.
- **Named volume ownership**: the orchestrator image runs as a non-root user, so the workspace
  root must exist in the image with that ownership before the volume is mounted, or the first
  write fails with EACCES.
- **Disk grows without bound** across mirrors and released tasks' branches → accepted for Phase 1
  and named as a Phase 6 item; branches are kept deliberately, because losing an archived task's
  history is worse than paying for it.

## Migration Plan

No database migration: the schema already carries `artifacts`. Deployment adds a workspaces
volume, `git` and `openssh-client` in the orchestrator image, and new environment settings
(`WORKSPACE_ROOT`, `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `REPO_SSH_KEY_PATH`) with defaults that
keep local development working without a key. Rollback is a revert plus deleting the workspace
root; nothing in Postgres changes shape.

## Open Questions

None. Mirror retention — the one question this design leaves unimplemented — is answered but
deferred: mirrors are kept, and a sweep is a Phase 6 job. It has everything it needs already,
since `tasks.repo_url` records which repository each task targeted and the mirror key is a pure
function of that URL: the live set is computed from the tasks, not parsed back out of directory
names. What gates the sweep is not information but ordering — until Phase 5 pushes task branches
to the remote, a mirror is the only copy of every archived task's history, so "unreferenced" may
only mean "no task ever targeted this repository", never "all its tasks are archived".
