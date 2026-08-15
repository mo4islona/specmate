## Context

See proposal.md — Why. The relevant current state:

- `runner/Dockerfile` is `node:22-alpine` plus the pinned provider CLI. Alpine is musl-libc;
  most prebuilt toolchain binaries (Python, many Node native modules, Playwright) assume glibc.
- `StageRequest.image` and `ExecSpec.image` already exist as a per-task override with no one
  feeding them; `needsContainerRuntime` is a per-request boolean the caller must decide.
- The auth volume is mounted at `HOME` (`/home/agent`) read-write; anything a tool writes under
  `HOME` by default lands in it.
- The local backend runs stages on the developer's machine and is out of scope: there the
  toolchains are whatever the machine has.

## Goals / Non-Goals

**Goals:**

- A stage can build and test any repository whose needs are language toolchains at declared
  versions.
- One environment per task, resolved by code, recorded before the first code-touching stage.
- Zero new SpecMate-specific files in target repositories.

**Non-Goals:**

- Supporting repositories whose builds need system packages beyond the image baseline
  (see proposal Non-goals: that is the future devcontainer path).
- Optimizing first-install latency beyond the shared cache.

## Decisions

### One universal image on Debian slim, not per-repo images, not host toolchains

The runner image becomes `debian:bookworm-slim` + pinned provider CLI + pinned
[mise](https://mise.jdx.dev). Alternatives rejected:

- **Forwarding toolchains from the host**: host binaries are the wrong platform (macOS dev
  hosts), the wrong libc (alpine vs glibc), and unpinned — the environment a stage ran with
  would be whatever the host had that day. It also cannot serve two repos wanting two versions.
- **Building an image per repo** (devcontainer base + CLI layer): correct but expensive — a
  build step, a registry, digest management — and unnecessary until a repo needs system
  packages. The pin's image field keeps this door open; nothing else assumes "one image".
- **Keeping alpine and adding toolchains**: musl breaks enough prebuilt binaries (Python
  builds from source, Playwright unsupported) that the base must change anyway.

### mise provisions from the repository's own files

mise natively reads idiomatic declarations — `.nvmrc`, `.node-version`, `.python-version`,
`rust-toolchain.toml`, `.tool-versions`, `.mise.toml` — so the repository stays the single
source of truth and SpecMate introduces no manifest of its own. mise itself is pinned by
version in the Dockerfile, same discipline as the provider CLI.

Provisioning happens in an image **entrypoint**: `mise install --yes` in the workdir, then
`exec` the CLI argv the backend passed. This keeps the executor and backend interfaces
unchanged — the contract "toolchains are ready before the agent starts" lives in the image. An
entrypoint failure exits before the CLI runs, which the runner already reports as a failed
stage distinguishable from an agent failure (non-zero exit, no `RESULT.json`).

### The toolchain cache is its own volume, never inside the auth volume

`MISE_DATA_DIR` is set to a fixed path (`/mise`) backed by a named volume shared by all runner
containers. Two reasons it cannot default: mise's default is under `HOME`, which is the auth
volume — session material and gigabytes of toolchains must not share a lifecycle or a backup
policy; and the cache must be mountable into every task's containers while the auth volume
stays per provider.

### Detection is code in the workspace package, run at provision

A pure function over the cloned tree: probe the well-known declaration files, return the
declared toolchain list. It runs when the workspace is first provisioned (the clone exists,
no agent has run) and writes the pin. It deliberately does **not** try to be clever: no
lockfile heuristics beyond presence checks (`bun.lock` → bun, `Cargo.toml` → rust), because
mise re-reads the declarations authoritatively inside the container anyway — the detected list
exists for the pin record and for failing fast on toolchains mise cannot provide.

### The pin is a jsonb column on `tasks`

`tasks.environment: { image: "<repo@digest>", toolchains: [{ name, version? }] }`, nullable
until provision. Written once by provision; re-pin is an explicit update that also appends an
event, satisfying the "recorded observably" requirement. Stages read it through the
orchestrator into `StageRequest.image` — the field that already exists.

### Container runtime derives from the role contract

`StageRequest.needsContainerRuntime` is removed; the executor computes
`ROLE_CONTRACTS[role].writesCode` and sets `ExecSpec.containerRuntime` from it. The docker
socket is host-root-equivalent, so the rule is a constant in code, not data anyone can toggle:
roles that execute repository code (implementer, verifier) hold it, artifact-only roles never
do. Granting it per repo was rejected as security theater — code written by the implementer
runs under the verifier's socket one stage later regardless — and detection false-negatives
would fail harness runs confusingly.

## Risks / Trade-offs

- [Shared cache is writable by stages running repository code] → A hostile build script could
  poison a cached toolchain used by other tasks. Accepted for v1: the same stages hold the
  docker socket, which already grants strictly more. Revisit together with the DinD-sidecar
  work that takes the socket away.
- [First install of a large toolchain eats into the stage timeout] → The cache makes it a
  once-per-version cost; if it recurs, provisioning can move to task setup, outside the stage
  deadline. Not built now.
- [Debian image is larger than alpine] → Pulled once per host; size is not a per-stage cost.
- [A repo declares a toolchain mise cannot provide] → Detection fails the task at provision,
  naming the toolchain — before any agent time is spent. The message points at the
  devcontainer path as the eventual answer.
- [`mise install` needs network egress] → Already true for the provider CLI; the future egress
  allowlist (Phase 7) must include the toolchain hosts, noted here so it is not forgotten.

## Migration Plan

1. Ship the new image under the same tag scheme with a new name (`specmate/runner-universal`),
   keep `specmate/runner-claude` buildable until the switch is verified.
2. Compose: add the `specmate_toolchains` volume; flip the default image config.
3. DB migration adds `tasks.environment` (nullable — existing tasks keep running unpinned on
   the default image until re-provisioned).
4. Rollback is config: point the image back and stop writing pins; the column is inert.
