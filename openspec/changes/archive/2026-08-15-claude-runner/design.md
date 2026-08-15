## Context

See proposal.md — Why. The constraints that shape the approach:

- `packages/core` already fixes the boundary: `AgentProvider.run(StageJob) → StageOutcome`,
  `StageJob` carrying an already-assembled `prompt` and an absolute `workspacePath`, and
  `parseStageResult` for `RESULT.json`. This change fills that interface in; it does not redraw it.
- `packages/workspace` already provisions a worktree per task at a path derived from the slug,
  reserves `RESULT.json` and `.specmate/` as scratch excluded from commits, and commits per stage.
  A stage's durability boundary therefore already exists; execution slots in front of it.
- The worktree is a git *worktree*: its `.git` is a file pointing into the shared bare mirror.
  A container that mounts only the worktree has no working git repository — deliberately, see below.
- One server, one orchestrator process, one owner. Provider authentication is a single stored
  session, not a per-user credential store.
- Phase 1 has exactly one provider. The design's job is to make the second one a build target and
  a config entry rather than a second code path.

## Goals / Non-Goals

**Goals:**
- One stage executes the same way whether it runs in a container or as a local subprocess, so the
  pipeline can be developed on a laptop and still be isolated on the server.
- A stage cannot read another task's work, the database credential, or the repository key — by
  construction, not by convention.
- A failure is diagnosable after the fact: the prompt that was sent, the output that came back,
  and the reason it was rejected all survive the failure.
- Testable with no network, no provider credential, and no container runtime in CI.

**Non-Goals:**
- Deciding *which* stage runs — the orchestrator loop is the next change.
- A general sandbox. The isolation here is the container boundary plus what is mounted into it;
  egress control and seccomp profiles are Phase 7.
- Streaming a run's output to the UI. Logs are files this change writes and a later change reads.

## Decisions

### The runner is an image, not a service; one container per stage

`docs/plan.md` §9.1 lists `runner-claude`, `runner-codex`, `runner-copilot` as Compose services.
This change diverges: a runner has no work loop of its own, because the orchestrator already owns
the queue and the state machine, so a long-lived runner would only be a second place for a stage
to be scheduled. It is declared in Compose under a profile so `docker compose build` builds it and
`docker compose run` can perform the one-time interactive login, and `docker compose up` never
starts it.

The stage-scoped container is what buys the properties worth having:

- **Credentials.** The orchestrator holds `DATABASE_URL` and the repository key; the container is
  started with neither. Running the CLI as a child process of the orchestrator would hand both to
  an agent that executes a foreign repository's code.
- **Fresh context by construction.** `agent-contracts` requires that no stage depend on an earlier
  stage's history. A discarded filesystem enforces that for free — no leftover CLI session state,
  no cache, nothing to remember to clean.
- **Bounded blast radius.** `--cpus` and `--memory` cap a stage; a deadline is enforced by killing
  a container, which is a single well-defined operation, rather than by killing a process tree that
  the agent itself may have grown.

Additional providers become build targets in the same Dockerfile, selected by an image name in
configuration. They are not new services and they do not change the orchestrator.

### The backend chooses where a process runs, and nothing else

One interface — run this argument vector, with this stdin, this timeout, these limits, in this
workspace; return exit code, stdout, stderr, duration. Two implementations: a subprocess, and the
same vector wrapped in `docker run --rm`. Everything above it — prompt assembly, argument
construction, log capture, result parsing, the scope check — is shared and backend-agnostic. That
is what makes the spec's "behavior does not differ between environments" cheap to hold rather than
a claim to re-verify in two places.

The alternative, a custom entrypoint script baked into the image, was rejected: it splits the
invocation logic across the repository and the image, and the local backend would then have to
reimplement or shell out to it.

### Prompt assembly happens in the orchestrator; the container receives text

The runner image contains the CLI and nothing of SpecMate. `roles/*.md` ships in the orchestrator
image, the database is read there, and the diff is computed there — the container receives a
finished prompt and a mounted working tree.

The prompt is written to the stage's scratch directory and delivered on stdin rather than as an
argument: artifacts plus a diff will exceed a safe argument length, and a file that survives the
run is exactly what makes a bad result diagnosable later.

Consequence: the container needs no git. Since only the worktree is mounted and not the mirror it
points into, git inside the container cannot resolve the repository at all — which is the intended
outcome. The mirror holds every task's branches, so mounting it to make git work would hand each
stage the history of every other task against that repository.

### The prompt's fourth source is a code diff, and why that is not a leak

`agent-contracts` describes prompts as role prompt + artifacts + ledger, and `docs/plan.md` §4
gives the reviewer "diff + full change folder". Both are satisfied by rendering the task branch's
product-code diff (everything outside the change folder) into the prompt: the change folder is
presented as artifacts, filtered by the role's contract, and the code is presented as a diff.
The two do not overlap, so the filter still means something.

This concedes nothing, because every role has the whole working tree mounted and can read any file
in it. The prompt controls what is *presented*, not what is *reachable*; the enforcement of "this
role may not write product code" is the mechanical post-run check below, never the prompt.

### Two result channels, with different jobs

`RESULT.json` at the workspace root is the role contract — status, artifacts changed, decisions
needed, verdict, findings — parsed by `parseStageResult`. The CLI's own structured output envelope
is the run's telemetry: exit status, duration, token counts and cost. Keeping them separate means a
provider swap changes how telemetry is read and leaves the role contract untouched.

The result path is deleted before the attempt starts. It lives in the workspace scratch and is
excluded from commits, so it survives both a crash and the discard that precedes a retry — which
is precisely why a stale one would otherwise be read as the new attempt's answer.

### The scope check is mechanical, and runs before the commit

After a run, `git status --porcelain` is compared against the role's contract: a role with
`writesCode: false` that touched anything outside `openspec/changes/<slug>/` fails the stage. The
CLI is additionally started with a per-role tool allowlist, but that is defense in depth — the
authoritative statement is what the filesystem shows, because it is the thing the commit would
capture. Order is: run → parse result → scope check → commit. Nothing illegitimate reaches a commit.

Permission prompting is disabled in the container. The safety property is the container boundary
and the scope check, not an interactive gate that nobody is present to answer.

### Failure, discard, retry

A stage that fails for any reason — no result, malformed result, scope violation, timeout, non-zero
exit — has its uncommitted changes discarded and is attempted once more, per `agent-contracts`.
Discarding is a new workspace operation (`git reset --hard` plus `git clean -fd`, without `-x`, so
the scratch directory and its logs survive). Without it the second attempt would read artifacts as
a failed attempt half-rewrote them, which is the exact opposite of "context rebuilt from artifacts".

### Workspaces move to a host bind mount at an identical path

The orchestrator asks the host's container runtime to mount the task's worktree, and the path it
names is resolved by the runtime **on the host** — so a path inside a named volume does not exist
there. Mounting the whole named volume instead would hand each stage every other task's worktree,
which the spec forbids.

The fix is path identity: `WORKSPACE_ROOT` is an absolute path, bind-mounted from the host at the
same absolute path into the orchestrator, and the runner receives `-v <task worktree>:<same path>`.
Host and containers then agree on what a path means, and the mount is scoped to one task. This also
pre-empts the same trap for the verifier change, where a repository's own harness bind-mounts its
fixtures and would otherwise mount empty directories on the host.

### Authentication is a volume, and expiry is a first-class state

`~/.claude` in the runner is a named volume, mounted read-write because sessions refresh
themselves. It is populated once, interactively, by `docker compose run` against the runner image —
the only manual step in deployment. `healthcheck()` runs the CLI's own non-interactive check in the
same image with the same volume, so the answer comes from the thing that will actually run the
stage rather than from a heuristic on file timestamps.

Per `docs/plan.md` §9.2, only the official CLI on the owner's own account is used; headless usage
draws on the subscription's agent credit pool. Swapping to API-key billing is an environment
variable in the runner, not a code change.

### Package boundary and testing

New `packages/runner` depending on `@specmate/core` (contracts), `@specmate/db` (ledger), and
`@specmate/workspace` (paths, discard). Configuration is an explicit options object; the
orchestrator parses the environment and passes it in, so tests construct a runner against a
temporary directory with no environment at all.

Tests use the local backend with a stub executable on `PATH` that reads the prompt from stdin and
writes a prepared `RESULT.json` — including the failure shapes: no result, malformed result, a
scope violation, a non-zero exit, and a hang for the timeout path. CI needs no container runtime,
no network, and no credential. The docker backend's argument construction is unit-tested against
the expected vector; that it runs is verified manually on the server.

## Risks / Trade-offs

- **The orchestrator needs the container runtime socket, which is effectively root on the host** →
  accepted for a single-owner, private-network deployment, and recorded here rather than left
  implicit. It is the price of stage isolation; the alternative — a privileged broker process — is
  more moving parts for the same trust boundary. Phase 7 revisits it alongside the egress allowlist.
- **Path identity is a configuration invariant that fails confusingly when broken** → if the host
  bind path and `WORKSPACE_ROOT` diverge, the runner mounts an empty directory and the agent reports
  an empty repository. Startup preflight asserts the path is absolute and that a probe container
  sees the marker file the orchestrator just wrote.
- **CLI flags and output shape drift between releases** → the image pins an exact CLI version, the
  adapter is thin, and the telemetry parse tolerates unknown fields. A version bump is a deliberate
  change with the e2e task as its test.
- **A single stored session is a single point of failure for every task** → `healthcheck()` plus the
  `expired` state exists so tasks pause instead of failing one stage at a time; the watchdog that
  polls it is Phase 7.
- **The local backend is a loaded gun in production** → refusing to start in production when it is
  configured, mirroring how the API refuses to start without its shared secret.
- **Prompt growth is bounded by artifact and diff size, not by history** → the diff is capped and
  truncation is stated in the prompt rather than silent; the ledger is capped the same way. A task
  whose diff exceeds the cap is a task that should have been split, and the truncation notice is how
  a human finds out.
- **`git clean -fd` on discard removes untracked files the agent created deliberately** → that is
  the point, and everything committed by an earlier stage is untouched; scratch is preserved by
  omitting `-x`.

## Migration Plan

No database migration. Deployment adds: the runner image build, a `claude-auth` named volume, the
container runtime socket mounted into the orchestrator, and the switch of the workspaces volume
from a named volume to a host bind mount at an absolute path. That switch orphans the existing
named volume; Phase 1 has no production tasks yet, so it is a delete rather than a data migration —
if any workspace does exist, it can be recreated by re-provisioning, since the branch history lives
in the mirror.

One manual step, once per server: `docker compose run --rm runner` to log in interactively and
populate the auth volume.

Rollback is a revert plus removing the two mounts. Nothing in Postgres changes shape, and the
workspace discard operation is additive.

## Open Questions

Whether the CLI's reported cost figures are precise enough to enforce a per-task budget. This
change only records what the provider reports, and the budget caps that would depend on that
precision are Phase 2 — so the answer can be measured on real runs before anything is built on it.
If they turn out to be unusable, the fallback is wall-clock and iteration caps, which the caps
model already carries.
