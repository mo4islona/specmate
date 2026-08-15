## Context

See proposal.md — Why. Before this change, the runner image carried the provider CLI but not the
language toolchains needed by a target repository. The runner accepted an image override, but a
task did not supply a complete, durable environment pin. Toolchain declarations could therefore
be interpreted again at stage time and drift as the repository or a mutable image tag changed.

The local backend remains out of scope: it runs against the developer machine. The decisions
below apply to isolated runner containers.

## Goals / Non-Goals

**Goals:**

- A stage can build and test a repository whose dependencies are supported language toolchains.
- One complete environment is resolved by code and recorded before the first agent stage.
- Repository-native declaration files remain the source of requested toolchain constraints.
- Stages cannot mutate shared toolchain installations used by other runs.

**Non-Goals:**

- Repositories that require operating-system packages beyond the image baseline.
- Per-repository image builds or devcontainer composition.
- Agentic toolchain detection or harness-adequacy classification.
- Changing the local development backend's host-tool behavior.

## Decisions

### Use one pinned universal image on Debian slim

The runner image is `debian:bookworm-slim` plus pinned provider and toolchain-manager versions.
Debian supplies the glibc baseline expected by common prebuilt toolchains. A task may still use a
different image later, because the environment record treats the image as data rather than
assuming one global image.

Alternatives rejected:

- **Forward host toolchains:** host platform and installed versions are not reproducible across
  machines or concurrent repositories.
- **Build an image per repository:** correct for system-level dependencies, but adds an image
  build and distribution step that is not needed for language-only toolchains.
- **Keep Alpine:** its libc choice is incompatible with enough prebuilt tools to make a broad
  language runner unreliable.

### Detect declarations, then resolve the complete environment during provisioning

The workspace detector reads committed root declarations such as `.nvmrc`, `.node-version`,
`.python-version`, `rust-toolchain.toml`, `.tool-versions`, `.mise.toml`, and language manifests.
It returns requested tools and optional constraints; it does not install anything and does not
ask an agent.

The container backend then resolves the configured image to an immutable digest or image ID and
resolves every supported tool request to one exact version. Exact declarations remain exact;
version ranges select an exact satisfying release; versionless manifest declarations select an
exact available release. Unsupported or unsatisfiable declarations fail provisioning before an
agent stage starts.

The resulting image and exact versions are the only inputs used at stage time. The entrypoint
activates those exact tool specifications from an empty configuration root, so mutable
repository declarations are not re-read after the task pin exists.

### Populate reusable installations outside agent stages

Provisioning populates a dedicated shared installation directory before a stage is dispatched.
That operation receives the runner image and installation volume, but no task workspace or
provider session. Agent stages mount the installation directory read-only. Toolchain-manager
configuration, activation state, shims, and caches stay in the stage container's temporary
filesystem.

This retains reuse across tasks without allowing one repository's build to modify an executable
installation later tasks will trust. A cold volume affects provisioning latency, not the
environment selected for the task.

### Store the complete pin on the task

`tasks.environment` stores
`{ image: "<immutable-reference>", toolchains: [{ name, version }] }` as JSON. The column is
nullable for schema migration, but workspace provisioning must fill it before dispatch and stage
execution refuses a missing pin. Re-provisioning an already pinned task leaves it unchanged;
re-pinning is an explicit update that appends an event.

The orchestrator passes the complete object through `StageRequest.environment` and `StageJob` to
the backend. Passing only the image would permit the backend to reinterpret repository files and
would not satisfy the task-level pin.

### Derive container-runtime access from the role contract

The stage request cannot independently grant container-runtime access. The executor derives the
flag from `ROLE_CONTRACTS[role].writesCode`: roles permitted to modify and execute repository code
receive the runtime capability, while artifact-only roles do not.

## Risks / Trade-offs

- **Range resolution can change over time:** a later provisioning may select a newer satisfying
  release. Each task remains reproducible because it records the exact selection once.
- **First installation can be slow:** this cost occurs during provisioning and is amortized by
  the shared installation volume.
- **A declaration may be unsupported:** provisioning fails early and names the requested tool;
  repositories needing a broader environment require the future custom-image path.
- **Tool downloads require network access:** deployments must permit the sources required by
  their selected language toolchains.
- **The universal image is larger than the previous image:** it is pulled once and reused, while
  language installations remain outside the image.

## Migration Plan

1. Build and publish the universal runner image with pinned provider and toolchain-manager
   versions.
2. Add the shared installation volume and mount it read-only in stage containers.
3. Add the nullable `tasks.environment` column for schema compatibility; workspace provisioning
   fills it before any stage dispatch.
4. Route the complete environment pin through the orchestrator and reject stage dispatch for a
   task that has not been provisioned.
