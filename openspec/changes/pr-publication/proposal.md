## Why

`task-lifecycle` REQ-602 already names `publish` as a stage on the happy path, and `publish` is
already a reserved `task_status` value with a `pull_requests` table provisioned for it — but
nothing implements it. `packages/core/src/pipeline.ts` says so directly: *"The publish node joins
in Phase 6, so the final gate's approval archives directly."* Every change shipped so far has
deliberately deferred it (the archived `orchestrator-loop` proposal lists "No publication" as an
explicit non-goal). Today a task reaching `human_final_gate` approval jumps straight to
`archived`, and getting code into GitHub is entirely the owner's own manual `git fetch` +
`git push` + PR click, from a branch that lives only in a bare mirror on the server.

This is Phase 6 ("Publishing & summary polish", `docs/plan.md` §14) pulled forward at the owner's
request, narrowed to just the push-and-open-PR mechanics — not the D2/Mermaid diagram polish or
the MkDocs wiki site, which are independent slices of the same phase bullet and stay deferred.

## What Changes

- A new `publish` node becomes real in the `feature`/`bugfix` pipeline definition, sitting between
  `human_final_gate` and `archived`. It is orchestrator-executed, not agent-executed: no role, no
  runner container, no sandboxed credential.
- The pipeline catalog gains a third node kind alongside `stage` and `gate` — an **action** node:
  a step the orchestrator performs directly, with no human input and no agent role.
- On entering `publish`, the orchestrator pushes the task's branch (`task/<slug>`, already in the
  shared bare mirror) to the real GitHub remote and opens a pull request via the GitHub REST API
  (head = task branch, base = `task.baseBranch`, title = task title, body = the already-approved
  `summary.md` verbatim), then writes one row to the existing, currently-unused `pull_requests`
  table and advances the task to `archived`.
- `REPO_SSH_KEY_PATH` (an SSH deploy key) is replaced by a GitHub App authorized through the OAuth
  Device Authorization Flow — the same headless-login mechanism `gh auth login` uses, chosen
  because GitHub offers no API to mint a personal access token, so some one-time human approval is
  unavoidable regardless of credential shape. Setup is a one-time `github-login` admin command:
  the orchestrator requests a device code, the owner opens `github.com/login/device` on any
  device, enters the code, and approves — installing the App on the target repo(s) in the same
  flow if not already installed. The resulting access/refresh token pair is stored in the existing
  `app_settings` table, not `.env` — refreshed automatically before it expires, with no redeploy,
  no file, and no recurring manual step. It covers every git operation this system performs:
  workspace clone/fetch, the publish push, and the pull-request API call, and is held and
  refreshed only by the orchestrator process, the same place `REPO_SSH_KEY_PATH` already lived —
  never forwarded into a runner container, for the same reason as before: workspace operations run
  entirely in the orchestrator, before a runner container for a stage even starts. The resulting
  pull request is authored as the GitHub account that approved the device code, not a distinct bot
  identity — an accepted trade-off, see design.md's Risks.
- Publish failure (rejected push, branch protection, bad token, GitHub API error) fails the task
  outright with the reason recorded as an event, the same way any other task failure is surfaced —
  no new retry mechanism. The owner restarts the task to retry, same as REQ-610 already allows for
  any failed task; re-entry is idempotent because publish first checks for an existing
  `pull_requests` row before pushing or calling the API again.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `pipeline-definitions`: adds the action node kind to the catalog's node vocabulary; the
  `feature`/`bugfix` definition's shape changes to route `human_final_gate`'s approval through
  `publish` before `archived`.
- `task-lifecycle`: `publish` stops being a documented-but-unreachable terminal step and gains a
  concrete behavioral contract — push, open PR, record it, advance; fail the task on error rather
  than hang.
- `workspace-lifecycle`: REQ-709 changes from "the credential is incapable of writing" to "no
  workspace operation invokes a write, and the credential — whatever it can do — is never reachable
  by a stage or runner." Same practical guarantee for agents, one credential instead of two.
- `persistence`: adds the write contract for `pull_requests` — written once per task at publish
  time, never duplicated.

## Impact

- `packages/core/src/pipeline.ts`: new `ActionNode` type in the `PipelineNode` union; `publish`
  wired into `FEATURE_BUGFIX_PIPELINE` between `human_final_gate` and the terminal.
- `apps/orchestrator/src`: the tick loop's dispatch filter (currently `stage`-only) gains a second,
  in-process path for action nodes; a new module owns the push + GitHub API call + `pull_requests`
  write.
- `.env.example`, `docker-compose.yml`: `REPO_SSH_KEY_PATH` (an SSH key file mount) is replaced by
  `GITHUB_APP_CLIENT_ID` (a public identifier, not a secret — no file/volume needed), read only by
  the orchestrator — same isolation. The App's access/refresh tokens live in `app_settings`, not
  `.env` or Compose at all.
- `apps/orchestrator/src/admin.ts`: gains a `github-login` subcommand implementing the device-flow
  exchange and persisting its result to `app_settings`; this is the one-time (or re-run-on-lapse)
  human step this change requires.
- `packages/workspace/src/git.ts`: `gitEnv()`'s SSH-specific logic (`GIT_SSH_COMMAND`,
  `IdentitiesOnly`) is replaced by an HTTPS token-based remote; its existing SSH-focused test
  needs updating to match.
- No database migration: `publish` is already a `task_status` value and `pull_requests` already has
  every column this needs.
- No new runtime dependency: the push goes through the system `git` binary already used everywhere
  else in the codebase; the GitHub API call is a plain `fetch` (Bun has it built in) — no
  Octokit/`gh` CLI.

## Non-goals

- No dedicated "PR description" artifact with Mermaid diagrams tailored for GitHub rendering — the
  already-produced, already-human-approved `summary.md` is reused verbatim as the PR body. A nicer
  dedicated artifact is the rest of Phase 6, not this change.
- No D2 diagram generation and no MkDocs/wiki publishing — the other two-thirds of the Phase 6
  bullet, independent of this one.
- No UI surface for the resulting PR — no attention-inbox entry, no "View PR" link, no check-status
  polling. That is the already-scoped, not-yet-drafted `pr-tracking` change (Phase 3 breakdown,
  item 4), which watches a PR that already exists; this change is what makes one exist. Until
  `pr-tracking` ships, the PR URL is visible via the emitted event and the `pull_requests` row
  directly, not through the operator UI.
- No support for repositories `GITHUB_TOKEN` cannot access — multi-repo/multi-owner token scoping
  is left as an operational concern for whoever configures the token, not a system behavior.
- No bounded in-tick retry for a failed publish attempt (unlike REQ-613's stage-failure cap) —
  reuses the existing failed-task restart path (REQ-610/REQ-614) instead of inventing a second
  retry mechanism for one node.
