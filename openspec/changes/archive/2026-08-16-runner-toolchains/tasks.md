## 1. Universal runner image

- [x] 1.1 Build the runner on `debian:bookworm-slim` with pinned provider and toolchain-manager
      versions; verify the image and both CLIs start successfully
- [x] 1.2 Activate only the exact toolchains supplied in the task environment, without reading
      mutable repository declarations at stage time
- [x] 1.3 Keep mutable toolchain-manager configuration and state container-local; mount reusable
      installations read-only in stage containers; verify the composed configuration

## 2. Detection, resolution, and the task pin

- [x] 2.1 Detect supported root version files and manifests mechanically, including versionless
      manifest declarations and range constraints; cover each source with unit tests
- [x] 2.2 Resolve mutable images to immutable references and every toolchain request to one exact
      version; fail unsupported and unsatisfiable requests during provisioning
- [x] 2.3 Persist the complete resolved environment on first workspace provision, preserve an
      existing pin, and record explicit re-pins; cover all three paths with workspace tests
- [x] 2.4 Add `tasks.environment` with a generated migration and verify migration/schema parity

## 3. Runner wiring and isolation

- [x] 3.1 Require `StageRequest.environment`, pass the complete pin through `StageJob`, and reject
      orchestrator dispatch when a task has no provisioned environment
- [x] 3.2 Derive container-runtime access from `ROLE_CONTRACTS[role].writesCode`; verify every role
      and ensure callers cannot override the result
- [x] 3.3 Populate the shared installation directory in a provisioning container that receives no
      task workspace or provider session, then mount it read-only for agent stages

## 4. End-to-end and conformance

- [x] 4.1 Add unit coverage for exact/range/versionless resolution, immutable image selection,
      complete pin propagation, and read-only stage mounts
- [x] 4.2 Add a Docker-gated test proving a range resolves to one exact version, later repository
      edits do not change it, and an unsatisfiable request fails before an agent stage
- [x] 4.3 Build the universal runner and run the Docker-gated test in pull-request CI
- [x] 4.4 Add stable requirement and acceptance IDs, validate the archived deltas and living specs,
      and run formatting, type checks, migrations, and the full test suite
