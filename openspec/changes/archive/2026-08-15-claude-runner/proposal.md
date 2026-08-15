## Why

Phase 1 of `docs/plan.md` needs a walking pipeline, and the two pieces that exist — the workspace
and the role contracts — describe where a stage runs and what it must produce, but nothing yet
runs one. `AgentProvider` in `packages/core` is an interface with no implementation, `RESULT.json`
is a schema nothing writes, and the orchestrator's loop has no unit to sequence. Every remaining
Phase-1 change is blocked on being able to execute a single stage end to end.

Executing a stage means running an agent that edits files in a checkout of someone else's
repository, and for the implementer and verifier roles, runs that repository's code. That has to
happen somewhere other than inside the orchestrator process: a stage running there would inherit
the database credential, the repository key, and every other task's working tree, and a runaway
test suite would take the orchestrator's state machine down with it. So the executor is a
container per stage — not a long-lived runner service, because a stage's context must be
assembled fresh from artifacts and a fresh filesystem is the cheapest way to guarantee that.

## What Changes

- A provider adapter for Claude Code implementing `AgentProvider`: given a stage job, it assembles
  the prompt, invokes the CLI headless, captures the run, and returns a parsed `StageResult`.
- Prompt assembly from the role contract: the role's prompt file, the artifacts the role declares
  it reads, and a rendered task ledger — and nothing carried over from a previous stage.
- A task ledger rendered from the database: what the task is, which round of which loop it is in,
  and the previous reviewer's findings. It is the only state a stage sees that is not a file.
- Role prompt files for the six roles Phase 1 runs, versioned in the repository and injected by
  path from the role catalog.
- One execution interface with two backends: an ephemeral container per stage for the server, and
  a subprocess for development on a laptop. The backend decides only where a process runs; the
  argument list, the log capture, and the result parsing are identical in both.
- A runner image carrying the provider CLI and nothing else — built by Compose, never started by
  it. Providers are added later as build targets of the same file, not as new services.
- The runner receives the working tree of its own task and the provider's authentication volume.
  It does not receive the database URL, the repository key, or any other task's files.
- Bounded runs: a wall-clock timeout that kills the container, and CPU and memory ceilings, so one
  stage cannot starve the host.
- Result handling per the agent-contracts spec: a missing or malformed `RESULT.json` is retried
  once, and a second failure fails the stage rather than passing silently.
- A mechanical scope check after every run: a role that may not modify product code and did fails
  the stage, rather than having its output committed and reviewed as if it were legitimate.
- Discarding a failed attempt's uncommitted changes, so a retry starts from the last committed
  stage output rather than from a half-written artifact.
- A provider healthcheck that reports whether the stored authentication still works, so tasks can
  pause on an expired session instead of failing one stage at a time.
- A per-stage flag declaring that a role needs a container runtime for its own work. Phase 1
  defines the flag and leaves it off; the verifier change turns it on.

## Capabilities

### New Capabilities
- `agent-execution`: how one stage is executed — the prompt it is given, the isolation and limits
  it runs under, what is done with its result, and how a provider's authentication is checked.

### Modified Capabilities
- `service-topology`: the process inventory gains ephemeral agent runs alongside the long-lived
  services, and the orchestrator's dependency on a container runtime becomes part of the contract.
- `workspace-lifecycle`: a failed attempt's uncommitted changes can be discarded, restoring the
  working tree to the last committed stage output.

## Impact

- New `packages/runner` — prompt assembly, ledger rendering, invocation, execution backends,
  result capture, scope checking, healthcheck.
- New `roles/` at the repository root, read by the orchestrator during prompt assembly and shipped
  in the orchestrator image (not the runner image — the runner receives a finished prompt).
- New `runner/Dockerfile`, declared in Compose under a profile so it is built but never started.
- `apps/orchestrator` gains the runner configuration: backend, image, model, timeout, resource
  ceilings, and the provider authentication volume.
- `packages/workspace` gains the discard operation; no new configuration.
- Compose: the workspaces volume becomes a host bind mount at a fixed absolute path so that the
  path the orchestrator passes to the container runtime resolves to the same directory on the
  host; the orchestrator gains access to the container runtime socket and a named volume for
  provider authentication. Both are recorded as accepted risks in `design.md`.
- `.env.example` documents the new settings and the one-time interactive provider login.
- No database migration: `stages.result`, `stages.cost`, and `events` already exist.

## Non-goals

- No orchestrator loop. Which stage runs when, iteration caps, retries across stages, and
  recovery after a restart are the next change; this one executes exactly the stage it is handed.
- No second provider. Codex and Copilot adapters are Phase 5; the interface is built so that
  adding them is a build target and a configuration entry, not a change to the orchestrator.
- No container runtime inside the runner. The capability flag is defined and left off; harnesses
  that need to start containers are the verifier change.
- No spec-standard skill injection. The role catalog marks which roles receive it; the sync job
  that fetches it is Phase 2, so Phase 1 assembles prompts without it and records no skill
  revision.
- No planner or retro prompts — those roles belong to the kickoff-brief and Retro changes. A stage
  for a role with no prompt file fails with a message naming it.
- No cost accounting beyond recording what the provider reports. Budget enforcement is Phase 2.
- No network egress allowlist, no disk quotas, no credential rotation — Phase 7 hardening.
