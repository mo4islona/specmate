## 1. Package skeleton

- [x] 1.1 Create `packages/workspace` (`@specmate/workspace`) depending on `@specmate/core` and `@specmate/db`, wired into the workspace list and tsconfig references (verify: `bun run --cwd packages/workspace typecheck`)
- [x] 1.2 Define the configuration options object — workspace root, git identity, repository key path, lock timeout — with defaults that need no credential locally (verify: `packages/workspace/src/config.ts`)
- [x] 1.3 Define the public surface: `provision`, `commitStage`, `release`, and the returned workspace and commit records (verify: `packages/workspace/src/index.ts`)

## 2. Git invocation

- [x] 2.1 Implement the git runner: argv-only invocation, captured stdout/stderr, non-zero exit turned into an error naming the command (verify: `bun test packages/workspace`)
- [x] 2.2 Fix the environment on every invocation — `GIT_TERMINAL_PROMPT=0`, `GIT_SSH_COMMAND` with the configured key in batch mode, `GIT_CONFIG_GLOBAL=/dev/null` — and pass identity per invocation (verify: unit test asserts the spawned environment)
- [x] 2.3 Add the test fixture that builds a real origin repository in a temp directory and yields its `file://` URL (verify: `packages/workspace/test/fixtures.ts`)

## 3. Mirror cache

- [x] 3.1 Derive the mirror key from the normalized remote plus a short hash of the URL (verify: unit test — two remotes that normalize alike get different keys)
- [x] 3.2 Clone the bare mirror on first use, fetch it on subsequent use (verify: test — second provisioning against the same origin does not re-clone)
- [x] 3.3 Publish a new mirror atomically: clone into a temporary sibling, `rename` on success, sweep leftover temporaries (verify: test — a clone killed mid-way leaves no usable mirror, and the next provisioning succeeds)
- [x] 3.4 Serialize per-mirror work with a keyed in-process mutex plus a `mkdir` lock directory, re-checking for the mirror after acquiring so a waiter fetches instead of cloning (verify: test — two concurrent cold-start provisionings produce one clone and two working trees)
- [x] 3.5 Refresh the lock's timestamp while work is in progress and allow takeover only once it goes stale; a waiter that exceeds its bound fails with a diagnosable error (verify: tests — a slow clone is not taken over, an abandoned lock is)
- [x] 3.6 Fail with a message naming the missing branch when the requested base branch is absent on the remote (verify: test)

## 4. Provisioning and repair

- [x] 4.1 Create the task branch from the fetched base, and never move an existing task branch (verify: test — base advances, an existing task branch stays put)
- [x] 4.2 Add the worktree at the derived path; return the existing one when it is already there, with its commits intact (verify: test — provision twice, commits survive)
- [x] 4.3 Complete an interrupted provisioning: branch without worktree, and worktree path present but not a usable checkout (verify: tests for both states, committed work still present after repair)
- [x] 4.4 Write the scratch exclusions into the mirror's `info/exclude`, leaving the repository's own ignore files untouched (verify: test — `git status --porcelain` after dropping a `RESULT.json` is empty, repository `.gitignore` unchanged)

## 5. Change folder scaffolding

- [x] 5.1 Create `openspec/changes/<slug>/` when absent, and leave an existing one untouched (verify: test — pre-seeded artifacts survive re-provisioning)
- [x] 5.2 In a repository with no OpenSpec root, create the change folder and nothing else (verify: test — the working tree contains no other new tracked file)

## 6. Stage commits

- [x] 6.1 Stage all modifications and commit with the conventional subject plus the task/stage/role/provider/attempt trailers, returning the commit id (verify: test asserts trailers via `git log --format=%(trailers)`)
- [x] 6.2 Report "nothing changed" without creating a commit when the working tree is clean (verify: test — commit count unchanged)
- [x] 6.3 Make a repeated commit after a crash a no-op rather than an empty duplicate commit (verify: test — commit twice in a row, one commit results)

## 7. Artifact indexing

- [x] 7.1 Map change-folder paths to artifact kinds, leaving unrecognized files unmapped (verify: unit test over the path table)
- [x] 7.2 Re-scan the change folder after each commit and upsert path, kind, git object, and truncated snapshot into `artifacts` (verify: integration test against Postgres)
- [x] 7.3 Delete index rows whose files no longer exist, and skip files outside the artifact catalog (verify: integration test — deleted artifact disappears, stray file never appears)

## 8. Release

- [x] 8.1 Remove the working tree and prune it from the mirror, keeping the task branch resolvable (verify: test — `git rev-parse task/<slug>` still resolves after release)
- [x] 8.2 Refuse release while the task is not in a terminal state, and make a repeated release a no-op (verify: tests for both)

## 9. Runtime wiring

- [x] 9.1 Parse the workspace settings in the orchestrator's environment schema and construct the manager at boot (verify: `bun run --cwd apps/orchestrator typecheck`, process exits naming a bad setting)
- [x] 9.2 Install `git` and `openssh-client` in the orchestrator image and create the workspace root owned by the runtime user (verify: `docker compose build orchestrator`, `git --version` inside the image)
- [x] 9.3 Mount a workspaces volume and the read-only repository key in Compose, and document the new settings in `.env.example` (verify: `docker compose config`)

## 10. Verification

- [x] 10.1 End-to-end test over a `file://` origin: provision, write artifacts, commit, index, release — with the process's own state discarded between steps to prove idempotency (verify: `bun test`)
- [x] 10.2 Confirm the suite passes with no network and no configured key (verify: `bun run ci`)
