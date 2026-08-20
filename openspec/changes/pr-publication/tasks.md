## 1. Pipeline core

- [x] 1.1 Add an `ActionNode` type (`kind: 'action'`, `key: TaskState`, no `role`/`provider`) to the `PipelineNode` union in `packages/core/src/pipeline.ts`.
- [x] 1.2 Extend `validateDefinition` so an action node's key is checked for uniqueness and legality (same as today) without requiring a role — confirm the existing role check is already scoped to `kind === 'stage'` and, if not, scope it.
- [x] 1.3 Insert a `{ kind: 'action', key: 'publish' }` node into `FEATURE_BUGFIX_PIPELINE` between `human_final_gate` and the (implicit) terminal; change `human_final_gate`'s `approve` target from `'archived'` to `'publish'`.
- [x] 1.4 Update or add unit tests asserting the shipped definition's shape: `human_final_gate.approve === 'publish'`, `publish`'s forward edge resolves to `archived` (pipeline-definitions AC-413).

## 2. GitHub credential and configuration

- [x] 2.1 Replace `REPO_SSH_KEY_PATH` with `GITHUB_APP_CLIENT_ID` in `.env.example` — a public identifier, not a secret — with a comment explaining the App's access/refresh tokens live in `app_settings`, not `.env`.
- [x] 2.2 Update env validation in `apps/orchestrator/src/index.ts`: drop `REPO_SSH_KEY_PATH`, add `GITHUB_APP_CLIENT_ID` (optional string — public repos still work without it; publish will fail cleanly if it's unset or unauthorized).
- [x] 2.3 Update `docker-compose.yml`: drop the `REPO_SSH_KEY_PATH` file mount and env line on `orchestrator`; add `GITHUB_APP_CLIENT_ID` as a plain env var, still only on `orchestrator` — not `runner`/`api`/`web`.
- [x] 2.4 Add a test (or extend an existing config-validation test) asserting the runner's environment/build args never include the GitHub credential (`GITHUB_APP_CLIENT_ID` or the stored token) (workspace-lifecycle AC-736).
- [x] 2.5 Add a `github-login` subcommand to `apps/orchestrator/src/admin.ts`: request a device code from GitHub (`POST https://github.com/login/device/code` with `GITHUB_APP_CLIENT_ID`), print the `verification_uri` and `user_code` to the console, poll `https://github.com/login/oauth/access_token` per the returned `interval` until approved or expired, then write the resulting access token, refresh token, and both expiries to `app_settings` under key `github-auth`.
- [x] 2.6 Implement a token accessor used by workspace/publish code: read `github-auth` from `app_settings`; if the access token is near/past expiry, refresh it via the stored refresh token and write the new pair back before returning it; if no row exists or the refresh token itself has lapsed, fail with a message naming `github-login` as the fix (workspace-lifecycle AC-727).

## 3. Git transport and GitHub API

- [x] 3.1 Add a small `owner/repo` parser for `task.repoUrl` (SSH and HTTPS GitHub forms) — check `packages/workspace/src/paths.ts`'s `normalizeRemote` first; reuse or lift its logic rather than writing a second parser.
- [x] 3.2 Replace `packages/workspace/src/git.ts`'s `gitEnv()` SSH logic (`GIT_SSH_COMMAND`, `IdentitiesOnly`) with an HTTPS token-based remote — `https://x-access-token:<token>@github.com/<owner>/<repo>.git`, the token sourced at call time from the accessor in 2.6 (never a static env var) — used for workspace clone/fetch (`ensureMirror`) as well as the publish push; update `packages/workspace/test/git.test.ts`'s SSH-focused assertions to match.
- [x] 3.3 Implement the publish push against the shared mirror (already resolvable via `@specmate/workspace`'s `mirrorPath`/`Git` helpers): `task/<slug>` to the same HTTPS token remote.
- [x] 3.4 Implement the GitHub API call: `POST /repos/{owner}/{repo}/pulls` with `head`/`base`/`title`/`body`, using Bun's built-in `fetch` and the same token. `body` is the target repo's `summary.md` content read from the task branch at its current `HEAD`, verbatim.
- [x] 3.5 Handle both calls' failure modes (rejected push, non-2xx API response, network error) by returning a single descriptive reason string — this is what becomes the failure event's payload.

## 4. Orchestrator wiring

- [x] 4.1 Extend the tick loop's dispatch-candidate selection (`apps/orchestrator/src/engine.ts`) to also pick up tasks whose current node is `kind === 'action'`, executed in-process — not through `StageDispatcher` or the runner.
- [x] 4.2 On reaching the `publish` action node: check `pull_requests` for an existing row for the task first (persistence AC-338); if present, skip straight to advancing.
- [x] 4.3 If absent: run the push (3.3), then the PR creation (3.4), then write the `pull_requests` row (`url`, `state: 'open'`) — in that order, so a row is only ever written once a PR actually exists.
- [x] 4.4 On success, advance the task to `archived` via the node's forward edge, the same mechanism a completed stage already uses.
- [x] 4.5 On failure, set the task to `failed` and emit an event carrying the failure reason, following the same pattern `apps/api/src/app.ts` already reads for other task failures — do not add a `stages` row and do not add a new retry loop.
- [x] 4.6 Unit-test all four branches: fresh publish success, re-entry with an existing PR row, push failure, API failure (task-lifecycle AC-632/AC-633/AC-634).

## 5. Deploy and docs

- [ ] 5.1 Update `deploy/RUNBOOK.md`'s credentials table (added alongside this change, above *Reaching the UI*): flip `REPO_SSH_KEY_PATH`'s row from "live" to retired (or remove it) and add a `GITHUB_APP_CLIENT_ID` row, once this change is actually deployed to the production box. Document the two one-time operator actions: registering the GitHub App (Contents R&W, Pull Requests R&W, Device Flow enabled, webhook off) and running `github-login` once containers are up; note that it only needs re-running if the stored refresh token lapses (design.md's Risks).
- [ ] 5.2 Run `bun run spec:validate` and `bun run spec:lint` and fix any reported issues before this change is applied.
