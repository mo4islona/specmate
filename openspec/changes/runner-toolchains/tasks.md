## 1. Universal runner image

- [ ] 1.1 Rewrite `runner/Dockerfile` on `debian:bookworm-slim`: pinned provider CLI, pinned
      mise (`MISE_VERSION` build arg, build fails when unset), `MISE_DATA_DIR=/mise`, the fixed
      `agent` uid unchanged — verify with `docker build` and `docker run … mise --version`
- [ ] 1.2 Add the entrypoint script: `mise install --yes` in the workdir, then `exec "$@"`; a
      failed install exits non-zero before the CLI starts — verify by running the image against
      a fixture tree declaring an unsatisfiable version
- [ ] 1.3 Compose: add the `specmate_toolchains` named volume, mount it at `/mise` in runner
      invocations, rename the image to `specmate/runner-universal` — verify with
      `docker compose config`

## 2. Toolchain detection and the task pin

- [ ] 2.1 Add `detectToolchains(tree)` to `packages/workspace`: presence/content checks for
      `.mise.toml`, `.tool-versions`, `.nvmrc`, `.node-version`, `.python-version`,
      `rust-toolchain.toml`, `bun.lock`, `Cargo.toml`, `pyproject.toml`, `package.json` —
      deterministic, with fixture tests per manifest and for the empty repo
- [ ] 2.2 Add `tasks.environment` jsonb (nullable) to `packages/db` with a generated migration —
      verify with `bun run db:generate` producing exactly one migration and `bun test`
- [ ] 2.3 Write the pin at workspace provision (image reference from config, detected
      toolchains) and append the environment event; re-provision of a pinned task does not
      overwrite the pin — verify with workspace tests

## 3. Runner wiring

- [ ] 3.1 Feed `StageRequest.image` from the task pin in the orchestrator's stage dispatch,
      falling back to the configured default when the pin is absent — verify with executor tests
- [ ] 3.2 Remove `needsContainerRuntime` from `StageRequest`; the executor derives
      `ExecSpec.containerRuntime` from `ROLE_CONTRACTS[role].writesCode` — update
      `packages/runner` tests: implementer and verifier get the socket, every other role does
      not, regardless of request shape
- [ ] 3.3 Mount the toolchain volume and pass `MISE_DATA_DIR` in `DockerBackend.argv` — verify
      the assembled argv in backend tests

## 4. End to end

- [ ] 4.1 Docker-gated integration test: a fixture repo declaring a toolchain runs a stage in
      the built image and the declared version is on the stage's PATH; second run reuses the
      cache (no re-download in the mise log)
- [ ] 4.2 Run the full suite and spec validation — `bun run ci` green
