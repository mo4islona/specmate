## Context

See `proposal.md` for motivation. Relevant current shape, confirmed by reading the code before
drafting this:

- `packages/core/src/pipeline.ts`'s `PipelineNode` union has exactly two kinds — `StageNode`
  (role + provider binding, dispatched to a runner) and `GateNode` (waits on a human). The tick
  loop (`apps/orchestrator/src/engine.ts`, around the `NOT_RUNNABLE`/dispatch-candidate logic)
  only ever picks up nodes where `node.kind === 'stage'`.
- `publish` is already a `task_status` enum value (`packages/db/src/schema.ts`), already excluded
  from `RESERVED_STATES`, so it's already a legal node key — just unused in
  `FEATURE_BUGFIX_PIPELINE`, whose `human_final_gate` currently approves straight to `archived`.
- `pull_requests` (`id, task_id, url, state, checks_state, updated_at`) already exists and is
  written by nothing. No migration is needed to use it.
- The task's branch (`task/<slug>`) lives in a bare mirror shared by every task against that
  repository (`packages/workspace/src/mirror.ts`'s `ensureMirror`, `origin` set to `task.repoUrl`).
  `packages/workspace/src/git.ts`'s `gitEnv()` is the only thing that shapes git's environment for
  any git call today, and it only ever configures `GIT_SSH_COMMAND` for the read-only
  `REPO_SSH_KEY_PATH`.
- **`REPO_SSH_KEY_PATH` is mounted only into the orchestrator container** (`docker-compose.yml`) —
  the `runner` service's block (further down the same file) mounts nothing git-related at all.
  Every git operation this system performs — clone, fetch, worktree provisioning, stage-output
  commit — already runs entirely inside the orchestrator process, *before* a runner container for
  a stage is even started. A stage/agent has no git credential today regardless of what that
  credential can do, because it never runs git in the first place. This is the load-bearing fact
  behind the single-token decision below.
- No HTTP client dependency exists anywhere in `apps/orchestrator`; Bun's built-in `fetch` is
  already how the codebase would make an outbound call if it needed one.
- Task-level failure is surfaced today by emitting an event and setting `tasks.status = 'failed'`
  (`apps/orchestrator/src/engine.ts`, e.g. the `failureReason` writes into `stages`/events, and
  `apps/api/src/app.ts` reads `failure?.payload.reason` off the event to build the UI's failure
  detail) — no dedicated "why did the task fail" column exists on `tasks`. Publish failure follows
  the same pattern rather than inventing a new one.

## Goals / Non-Goals

**Goals:**
- Make `publish` a real, orchestrator-executed step that needs no agent and no runner.
- Reuse every existing mechanism that already fits (the `stages` table's failure/restart model is
  explicitly *not* reused — see Decisions — but the event log, `pull_requests`, and the
  `human_final_gate → publish → archived` shape all are).
- One credential set, minimum *recurring* manual work — simplicity was an explicit requirement
  from the owner over the course of drafting this. The owner explicitly weighed and rejected: a
  two-credential split (see Decisions and Risks), a manually-generated PAT (recurring yearly
  regeneration), and a JWT-signed GitHub App installation-token flow (upfront setup complexity —
  private key handling, JWT signing code — for a benefit disproportionate to this deployment's
  single-repo scale). What's chosen instead trades one one-time interactive approval for zero
  recurring manual work — see Decisions.

**Non-Goals:** see proposal.md's Non-goals section — not repeated here.

## Decisions

**One GitHub credential, not a read/write split.** The first draft of this change used two
credentials — a read-only deploy key for workspaces, a separate write-scoped token for publish —
specifically to keep a stage/agent from ever being able to reach a write-capable credential. The
Context section's finding makes that split unnecessary: a stage/agent never runs git at all, so it
never sees *any* git credential, regardless of whether that credential can write. Holding one
read-and-write credential only in the orchestrator (exactly where `REPO_SSH_KEY_PATH` already
lived) preserves the guarantee that actually matters — an agent can't write — at zero cost, because
the credential was already unreachable from the runner for reasons that have nothing to do with
its scope. What a single credential gives up is defense-in-depth against a bug in the
orchestrator's *own* workspace-operation code (see Risks); what it buys is one thing to configure
instead of two, and one failure mode instead of two independent ones. The owner chose that trade
explicitly, prioritizing setup simplicity for adoption's sake.

**HTTPS token, not an SSH deploy key.** The GitHub App's access token (Contents: Read & Write +
Pull Requests: Read & Write, scoped to whatever repo(s) the App is installed on) replaces
`REPO_SSH_KEY_PATH` entirely — it authenticates workspace clone/fetch, the publish push, and the
pull-request API call, all through one mechanism. Clone/fetch and push both target
`https://x-access-token:<token>@github.com/<owner>/<repo>.git`; `owner/repo` is parsed from
`task.repoUrl`, which already supports both SSH and HTTPS GitHub forms today, so the parser needs
to keep accepting both even though the credential is now HTTPS-only. `gitEnv()`'s SSH-specific
logic (`GIT_SSH_COMMAND`, `IdentitiesOnly`) goes away.

**GitHub App authorized via OAuth Device Flow, not a manually generated PAT.** GitHub provides no
API to mint a personal access token of any kind — fine-grained or classic — creating one is
inherently a manual, human, browser-based action; this is a deliberate GitHub security boundary,
not a gap. Given some one-time human action is unavoidable regardless of credential shape, the
question is where it recurs, not whether it exists at all. A manually generated PAT recurs: it
expires at most a year after issuance (fine-grained tokens cannot be non-expiring) and needs the
owner to regenerate and re-paste it into `.env` on that cadence, forever. The OAuth Device
Authorization Flow — the same mechanism `gh auth login`, `docker login`, and `aws configure sso`
use — needs no redirect URL, no local web server, and no stable server address, which fits this
deployment's self-managed, address-not-fixed hosting exactly: the orchestrator requests a device
code, the owner opens `github.com/login/device` on any browser, enters the short code, and
approves — installing the App on the target repo in the same screen if not already installed. The
resulting access token is refreshed automatically in the background using its refresh token before
every use near expiry; the owner is not involved again unless the refresh token itself lapses (see
Risks), at which point the fix is re-running the same one command, not recreating anything. A
JWT-signed App-installation-token flow (minting a token as the App's own bot identity rather than
as an approving human) was also considered and rejected here: it needs no device-flow interaction
at all, but costs private-key handling and JWT-signing code for a benefit — a distinct bot
identity, install-time-only interaction — that's disproportionate to this deployment's
single-repo, single-owner scale. It remains available as a later refinement (see Risks) without
requiring a different App registration.

**Access/refresh tokens live in `app_settings`, not `.env`.** A device-flow token pair is
runtime-refreshed state, not static configuration — writing a fresh token back to a `.env` file on
disk would need the orchestrator to rewrite its own environment file and reload it, a shape
nothing else in this codebase does. `app_settings` (`key`, `value: jsonb`) already exists exactly
for this: it's the generic mechanism `model-defaults` already uses for a setting that isn't a
migration-worthy column. One new row (key `github-auth`) holds the access token, refresh token,
and both their expiries; no database migration is needed. `.env` keeps only
`GITHUB_APP_CLIENT_ID`, a public identifier safe to commit to `.env.example` as a placeholder and
uninteresting to leak.

**A `github-login` subcommand on the existing `admin.ts` CLI, not a new setup tool.**
`docs/plan.md` already documents an equivalent one-time interactive step for the coding agent's
own session ("authenticate once interactively inside the runner container; persist the
session/config dir as a Docker volume") — this reuses that same shape for GitHub instead of
inventing a different setup ritual. `admin.ts` already hosts comparable one-shot operator commands
(`create`, `approve`, `restart`, ...); `github-login` fits the same file rather than becoming a new
binary or a UI flow. Running it is required once before the first publish, and again only if the
stored refresh token lapses.

**A third `PipelineNode` kind (`action`), not a `StageNode` with a fake role.** A `StageNode`
requires a `role` and `provider` and is dispatched through `StageDispatcher` into a runner
container — precisely the sandboxed path `GITHUB_TOKEN` must never reach (REQ-709). Modeling
publish as a stage would mean either (a) inventing a non-agent pseudo-role just to satisfy
`role: roleEnum().notNull()` on the `stages` table, which is conceptually wrong and ripples into
every place that assumes a stage's role names an agent, or (b) making `role` nullable, a wider
schema change than this needs. A new `kind: 'action'` node, executed in-process by the engine and
never touching `stages`, `StageDispatcher`, or the runner image, is the smaller and more honest
shape.

**No `stages` row for a publish attempt; task failure is enough.** REQ-613's stage-attempt-cap
machinery exists because agent output is unreliable and needs discard-and-retry semantics against
a worktree. A publish attempt is a deterministic external call (git push, one REST call) that
either succeeds or names a concrete reason it didn't (rejected push, 401, network error) — the
same shape as any other task failure. Reusing REQ-610/REQ-614's existing failed-task restart path
means a failed publish is retried by restarting the task, exactly like a failed implementation
stage is today. No new retry-cap concept, no new table, no schema change.

**Idempotency by checking `pull_requests` first, not by force-pushing.** Nothing else ever pushes
to `task/<slug>` on the remote, so a plain (non-force) push is always either a no-op fast-forward
or the first push — there is no history to overwrite. Before pushing or calling the GitHub API,
publish reads `pull_requests` for an existing row on the task; if one exists, publish has already
happened and the node just advances. This is the only idempotency check needed and it costs one
read.

**Body is `summary.md` verbatim; no new artifact kind.** The already-approved final summary is
exactly what a human just signed off on at `human_final_gate`. Generating a second, differently
-shaped "PR description" artifact (Phase 6's fuller ambition) is deferred — see proposal.md's
Non-goals.

**Failure path emits an event; no new column.** Matches the existing convention the Context
section describes — a `task.failed`-shaped event with a `reason` in its payload, read by
`apps/api/src/app.ts` the same way any other failure reason already is.

## Risks / Trade-offs

**A single token that can both read and write sits in the same process that performs ordinary,
frequent workspace reads.** The "agents can't write" guarantee no longer comes from the credential
being incapable of it — it comes from workspace-operation code (`@specmate/workspace`) simply never
calling push, and only the dedicated publish path doing so. A bug that made a workspace operation
call push would now be *able* to succeed, where before it would have failed on a read-only
credential regardless. Mitigation: REQ-709 keeps its normative "no workspace operation writes"
behavior as a code-level contract; the two-credential split remains available as a follow-up if
this is ever revisited, and nothing in this design forecloses it — splitting `GITHUB_TOKEN` into
two env vars later is a config change, not a re-architecture.

**A single credential must be valid for every repo a task might target.** Fine for the current
single-owner, effectively-single-repo deployment. A GitHub App installation can in fact cover
multiple repositories under one owner (select "All repositories," or add more later from the same
installation without re-authorizing) — so this isn't a hard ceiling, just something whoever
installs the App must get right. A task targeting a repo under an owner the App was never
installed on fails at publish naming that as the reason; re-running `github-login` against that
owner is the fix. Not solved further here; flagged in proposal.md's Non-goals.

**The stored refresh token can lapse if publish goes unused for a long stretch.** GitHub issues a
new refresh token (typically valid ~6 months) on every successful refresh, so as long as at least
one task publishes within that window the credential renews itself indefinitely without the owner
noticing. If SpecMate publishes nothing for longer than that, the next publish attempt fails
naming the lapsed authorization as the cause — the fix is re-running `github-login`, not
recreating the App or its installation. This is a materially smaller and less certain risk than
the PAT design's guaranteed once-a-year expiry regardless of use, but it is a live-but-currently-
unmonitored one; proactive expiry monitoring remains out of scope here for the same reason it was
before — it belongs with Phase 7's "Auth watchdog" (`docs/plan.md` §14), which already covers the
analogous problem for the provider's own session (`provider_credentials.auth_state`), and should
cover this credential the same way once built rather than getting a bespoke check here.

**The resulting pull request is authored as the GitHub account that approved the device code, not
a distinct bot/machine identity.** Anyone reading the PR's author sees a human account, not
"specmate-bot" or similar — acceptable for the current single-owner deployment, where that account
is the owner's own, but worth naming explicitly since it's a real choice, not a side effect: a
JWT-signed App-installation-token flow (see Decisions) would post as the App's own bot identity
instead, at the cost of the private-key/JWT setup this design avoids. Switching later is additive
if this ever needs to change — the same App registration works for either token style.

**Publish failing for a reason a restart won't fix (e.g., branch protection permanently rejecting
the head branch) leaves the task `failed` until a human intervenes.** This is the intended
behavior (REQ-616/AC-634) — silent hanging would be worse — but it does mean there's no
auto-diagnosis; the event's `reason` text needs to be specific enough to act on (push rejection
message or GitHub API error body, not a generic "publish failed").

**No UI surface until `pr-tracking` ships.** A human who doesn't know to check the event log or
query `pull_requests` directly won't see the PR link. Accepted per proposal.md's Non-goals; the
event is at least visible in the existing generic event timeline today.

## Migration Plan

No database migration — `app_settings` already exists and already supports an arbitrary new key
with no schema change. Deploy is the existing `deploy/deploy.sh --apply` path, plus two one-time
operator actions outside that script: registering the GitHub App on GitHub's website (Contents
R&W, Pull Requests R&W, Device Flow enabled, webhook off) and setting `GITHUB_APP_CLIENT_ID` in
`.env`; then, after the containers are up, running `github-login` once to complete the device-flow
approval. `REPO_SSH_KEY_PATH` is retired from `.env` and Compose. No rollback concern beyond the
general one (redeploy the previous commit); a rollback to a pre-this-change commit would need
`REPO_SSH_KEY_PATH` restored if the server's `.env` had already dropped it, the same as before.
