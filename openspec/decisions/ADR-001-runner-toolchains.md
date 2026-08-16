# ADR-001 — Resolve and pin runner environments during provisioning

- **Status:** Accepted
- **Date:** 2026-08-16
- **Canonical change:** `openspec/changes/archive/2026-08-16-runner-toolchains/`

## Context

Agent stages need repository-declared language toolchains, but interpreting mutable image tags
or repository declarations at every stage makes a task's execution environment drift over time.
Sharing writable tool installations between unrelated stages would also make reuse affect
correctness.

## Decision

Workspace provisioning detects repository-native declarations and resolves them once to the
complete environment defined by REQ-801 through REQ-804: an immutable runner image reference and
exact toolchain versions. The task stores that pin, every stage receives it, and the runner
activates only those exact versions.

Exact installations may be reused across tasks, but agent stages receive them read-only and keep
mutable toolchain-manager state local to the stage. Container-runtime access remains derived
from the fixed role contract defined by REQ-109.

## Consequences

- Tasks remain on the same image and toolchain versions until an explicit, recorded re-pin.
- Version ranges and versionless manifests are convenient inputs without becoming mutable stage
  inputs.
- Unsupported or unsatisfiable declarations fail during provisioning, before agent work begins.
- Cold provisioning can take longer, while later tasks can reuse the exact installation.
- Repositories that need additional system packages require a future custom-image path.
