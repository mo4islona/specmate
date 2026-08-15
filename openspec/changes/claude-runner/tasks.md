## 1. Package skeleton

- [x] 1.1 Create `packages/runner` (`@specmate/runner`) depending on `@specmate/core`, `@specmate/db` and `@specmate/workspace`, wired into the workspace list and tsconfig references (verify: `bun run --cwd packages/runner typecheck`)
- [x] 1.2 Define the configuration options object — backend, image, model, stage timeout, CPU and memory ceilings, roles directory, auth volume — with defaults that need no credential locally (verify: `packages/runner/src/config.ts`)
- [x] 1.3 Define the public surface: the provider adapter, the execution backend interface, and the prompt-assembly entry point (verify: `packages/runner/src/index.ts`)

## 2. Execution backends

- [x] 2.1 Define the backend interface: argv, stdin, cwd, environment, timeout, limits → exit code, stdout, stderr, duration (verify: `packages/runner/src/backend.ts`)
- [x] 2.2 Implement the local backend as a subprocess with a fixed environment, capped output buffers, and a deadline that kills the process group (verify: `bun test packages/runner` — a stub that hangs is killed and reported as timed out)
- [x] 2.3 Implement the docker backend: `docker run --rm` with the task worktree bind-mounted at its own absolute path, the auth volume, `--cpus`, `--memory`, a non-root user, and no service environment (verify: unit test asserts the exact argument vector, including the absence of `DATABASE_URL` and of any mount other than the two)
- [x] 2.4 Enforce the deadline in the docker backend by terminating the container, and report the outcome as timed out rather than as a provider failure (verify: unit test asserts the kill path and the distinct outcome)
- [x] 2.5 Add the test stub provider: an executable that reads a prompt on stdin and writes a prepared `RESULT.json`, with modes for missing, malformed, scope-violating, non-zero-exit and hanging runs (verify: `packages/runner/test/stub-provider.ts`)

## 3. Prompt assembly

- [x] 3.1 Read the role's prompt file from the configured roles directory; fail with a message naming the role and the expected path when it is absent (verify: test — unknown role prompt fails before any backend call)
- [x] 3.2 Collect the change-folder artifacts the role's contract declares it reads, and only those (verify: test — an artifact kind outside `reads` is absent from the assembled prompt)
- [x] 3.3 Render the product-code diff of the task branch against its base commit, excluding the change folder, capped in size with an explicit truncation notice (verify: test — a diff over the cap is truncated and the prompt says so)
- [x] 3.4 Assemble the prompt deterministically from role prompt, artifacts, ledger and diff, and write it to the stage's scratch directory (verify: test — assembling twice from the same state produces byte-identical output)
- [x] 3.5 Assemble successfully for a task with no artifacts and no code changes (verify: test — first stage of a fresh task produces a runnable prompt)

## 4. Task ledger

- [x] 4.1 Render the ledger from the database: task identity, type, target repository and base branch, current state, loop and round (verify: test against a seeded database)
- [x] 4.2 Include the previous review round's findings, and say so explicitly when there are none (verify: test — round two carries round one's finding ids)
- [x] 4.3 Cap the ledger's size with an explicit truncation notice, and carry no stage transcript (verify: test — the rendered ledger contains no captured provider output)

## 5. Role prompts

- [x] 5.1 Write `roles/researcher.md`, `roles/spec-writer.md`, `roles/implementer.md`, `roles/verifier.md`, `roles/reviewer.md`, `roles/summarizer.md`, each stating its inputs, its permitted outputs, and the requirement to end by writing `RESULT.json` (verify: files exist at the paths `ROLE_CONTRACTS` names)
- [x] 5.2 Assert the catalog and the filesystem agree for the roles Phase 1 runs (verify: test — every Phase-1 role's `promptFile` resolves)
- [x] 5.3 Ship `roles/` in the orchestrator image and not in the runner image (verify: `apps/orchestrator/Dockerfile`, and `docker run <runner> ls /roles` finds nothing)

## 6. Runner image

- [x] 6.1 Add `runner/Dockerfile` with a pinned provider CLI version, a non-root user, and no SpecMate code (verify: `docker build -f runner/Dockerfile .` succeeds and `claude --version` inside reports the pinned version)
- [x] 6.2 Declare the runner in Compose under a profile so it is built but never started by `up` (verify: `docker compose up` starts no runner container; `docker compose build` builds the image)
- [ ] 6.3 Add the `claude-auth` named volume and document the one-time interactive login (verify: `docker compose run --rm runner` reaches the login flow and the volume is populated afterwards)
- [x] 6.4 Switch the workspaces volume to a host bind mount at an absolute path identical inside the orchestrator (verify: `docker compose config` shows the same path on both sides)
- [x] 6.5 Mount the container runtime socket into the orchestrator (verify: `docker compose config`)

## 7. Provider adapter

- [x] 7.1 Build the CLI argument vector: headless mode, structured output, pinned model, prompts disabled, per-role tool allowlist, working directory (verify: unit test asserts the vector per role)
- [x] 7.2 Deliver the assembled prompt on stdin from the file written in step 3.4 (verify: test — the stub receives on stdin exactly what was written to scratch)
- [x] 7.3 Capture stdout and stderr to the stage's log directory in the workspace scratch, retained on failure (verify: test — the log of a failed run is present afterwards)
- [x] 7.4 Delete any prior `RESULT.json` before the attempt, and treat an attempt that wrote none as having produced none (verify: test — a stale result from a previous attempt is not returned)
- [x] 7.5 Parse `RESULT.json` with `parseStageResult` and return a `StageOutcome` with exit code and duration (verify: test — a valid minimal result is accepted)
- [x] 7.6 Parse the CLI's telemetry envelope into the outcome's usage, tolerating unknown fields, and record nothing when it is unparseable (verify: test — token counts surface; a garbled envelope does not fail the stage)
- [x] 7.7 Carry the stage's container-runtime declaration on the job, defaulting to off, and grant no runtime access when it is off (verify: test — the argument vector for an undeclared stage mounts no socket)

## 8. Scope check

- [x] 8.1 After a run, compare the working tree's changes against the role's contract and fail the stage when a role that may not modify product code has (verify: test — the stub writes outside the change folder as a researcher and the stage fails)
- [x] 8.2 Accept the same change for a role permitted to modify product code (verify: test — the same stub run as an implementer succeeds)
- [x] 8.3 Run the check before any commit, so a rejected run is never committed (verify: test — commit count unchanged after a scope violation)

## 9. Workspace discard

- [x] 9.1 Add the discard operation to `packages/workspace`: reset tracked files and remove untracked ones without `-x`, so scratch survives (verify: `bun test packages/workspace` — created files gone, log and result still readable)
- [x] 9.2 Leave commits on the task branch untouched, and succeed on an already-clean tree (verify: tests for both)
- [x] 9.3 Discard before a retry, so the second attempt reads the last committed artifacts (verify: test — attempt one rewrites an artifact and fails, attempt two sees the committed text)

## 10. Provider healthcheck

- [x] 10.1 Report `ok`, `expired` or `unknown` by running the provider's own non-interactive check in the runner image with the auth volume (verify: test against the stub — each state maps to the right report)
- [x] 10.2 Include the CLI version and exclude any credential material from the report (verify: test asserts no token-like string in the serialized status)

## 11. Orchestrator wiring

- [x] 11.1 Add the runner environment to `apps/orchestrator`: backend, image, model, timeout, ceilings, auth volume — validated at startup like the existing settings (verify: starting with an invalid value exits non-zero naming the variable)
- [x] 11.2 Refuse to start when the local backend is configured and `NODE_ENV=production` (verify: test — exit non-zero with an error naming the setting)
- [x] 11.3 Extend the startup preflight: with the docker backend, assert the runtime is reachable and that a probe container sees a marker file written by the orchestrator, exiting non-zero and naming the dependency otherwise (verify: run with the socket unmounted — the process exits non-zero with a diagnosable message)
- [x] 11.4 Expose a way to execute one stage end to end for manual verification, without the orchestrator loop (verify: a single stage against a scratch repository produces a commit and a parsed result)

## 12. Documentation

- [x] 12.1 Document the new settings, the path-identity requirement, and the one-time login in `.env.example` and `README.md` (verify: a fresh clone can be brought up following only those instructions)
- [x] 12.2 Record the container runtime socket as an accepted risk where a reader will find it (verify: `README.md` names it in the deployment section)

## 13. Validation

- [ ] 13.1 `bun run ci` passes (verify: command exits zero)
- [x] 13.2 `openspec validate --changes claude-runner --strict` passes (verify: command exits zero)
