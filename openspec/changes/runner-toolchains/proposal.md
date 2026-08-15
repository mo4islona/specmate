## Why

The runner image carries a provider CLI and nothing else, so a stage cannot build or test the
repository it is editing — one repo needs Node and Python, another Rust, and SpecMate itself
needs Bun, which the current image lacks. The implementer's own contract ("run whatever the task
named as its verification") is unsatisfiable today, and the Phase-1 exit criterion — a real
bugfix end to end — requires stages that can run the target repo's tests. This is Phase 1 work:
it completes the runner the walking skeleton depends on.

## What Changes

- The runner image becomes a universal toolchain image: provider CLI plus a toolchain manager,
  both pinned, on a glibc base. The repository itself declares the toolchain versions it needs
  through its own idiomatic files (`.nvmrc`, `rust-toolchain.toml`, `.tool-versions`, …); no
  SpecMate-specific manifest is introduced.
- Toolchain needs are detected mechanically — plain code reading committed files at workspace
  provision, no agent involved — and the resolved execution environment (image by digest,
  declared toolchains) is pinned on the task. Every stage of a task runs in the pinned
  environment; changing it mid-task is an explicit re-pin, never silent drift.
- Toolchain installs are cached in a shared volume, so a version is downloaded once and reused
  across stages and tasks.
- Container-runtime access (the harness's docker socket) stops being a per-stage judgment call:
  it is derived from the role catalog — exactly the roles permitted to modify product code
  receive it, and artifact-only roles never do, regardless of repo or task. The per-stage
  declaration from `agent-execution` stays as the mechanism; this change specifies who sets it
  and from what.
- The Planner's Phase-2 harness probe is unaffected: it judges harness *adequacy*, which needs
  an agent. Toolchain detection is deterministic and does not wait for it.

## Capabilities

### New Capabilities

- `execution-environment`: what environment a stage runs in — how a task's toolchain needs are
  detected from the repository, how the environment is pinned per task and recorded, that all
  stages of a task share one environment, and that toolchain provisioning is cached.

### Modified Capabilities

- `agent-contracts`: the role catalog gains a derived capability bit — container-runtime access
  follows the permission to modify product code; no role or configuration may grant it
  independently.
- `persistence`: a task additionally carries its pinned execution environment, with the same
  created-with semantics as caps and budgets.

## Impact

- `runner/Dockerfile`: base image moves from Alpine (musl) to Debian slim (glibc — prebuilt
  toolchain binaries assume it), adds a pinned toolchain manager and an entrypoint that
  provisions declared toolchains before the provider CLI starts.
- `packages/workspace` (or `packages/core`): a mechanical toolchain detector run at provision.
- `packages/db`: `tasks` gains the environment pin; one generated migration.
- `packages/runner`: `DockerBackend` mounts the toolchain cache volume; the executor derives
  the container-runtime flag from `ROLE_CONTRACTS[role].writesCode` instead of taking it as a
  per-request input; `StageRequest.image` is now fed from the task pin.
- `docker-compose.yml`: the toolchain cache volume joins the auth volume.
- Sequencing: builds directly on the `claude-runner` change (same packages, and the
  `agent-execution` capability this composes with is still a delta there). `claude-runner`
  should archive first.

## Non-goals

- No per-repo custom images (devcontainer-based bases for repos with system-level
  dependencies). That is the escalation path when the universal image is not enough; the pin's
  image field already leaves room for it.
- No task-scoped docker-in-docker sidecar. The host socket remains the runtime for
  code-running stages; moving it behind a disposable daemon is compatible later work.
- No agentic detection and no harness-adequacy classification — the Phase-2 harness probe
  builds *on top of* the pin, it is not replaced by it.
- No change to the local development backend: on a developer machine the toolchains are the
  machine's own.
- No OS-package installation for repos needing system libraries beyond the image's baseline;
  such a repo fails its stage loudly and waits for the devcontainer path.
