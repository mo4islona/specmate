Design decisions are referenced as D1–D13 and requirements by ID; neither is restated here.

## 1. The binding grows a provider

- [x] 1.1 Split the model catalog per provider in `packages/core/src/models.ts`: `PROVIDER_MODELS`
      keyed by `ProviderId`, `ModelId` a closed enum over the union, and a per-provider default
      model — D2, REQ-112. Verify: `bun run vitest run packages/core/test`.
- [x] 1.2 Add `provider` to `ModelBinding` and seed `DEFAULT_MODEL_BINDINGS` from the shipped
      provider — D1, D13, REQ-112. Verify: same command; every role seeds to a provider the shipped
      configuration runs, and the role catalog is free to prefer another.
- [x] 1.3 Resolve the provider before the model in `resolveModelBindings`, defaulting the model
      against the winning provider — D3, AC-137. Verify: same command; an override naming only
      `provider: codex` for one role resolves that role to a Codex model and leaves every other
      role untouched.
- [x] 1.4 Add the coherence check as an exported predicate over a `(provider, model)` pair, so
      intake and the settings update share one implementation — REQ-112, AC-136. Verify: same
      command.

## 2. The Codex provider

- [x] 2.1 Extract what both providers share out of `claude.ts` into a module both import — the
      scratch/prompt/`RESULT.json` protocol, `checkReviseHasFindings`, `run.log` and
      `telemetry.json`, `StageRunError` — leaving argv, event parsing and healthcheck behind —
      D11. Verify: `bun test packages/runner`; `claude.test.ts` passes unchanged.
- [x] 2.2 `CodexProvider.argv`: `exec --json`, the prompt from stdin, `-m <model>`,
      `-c model_reasoning_effort=<effort>`, the sandbox bypass, and `exec fork <session>` when the
      job resumes one — D9, REQ-209, AC-236. Verify: `bun test packages/runner`.
- [x] 2.3 Parse the JSONL stream: `thread.started.thread_id` as the session id, `turn.completed.usage`
      as telemetry with a null cost and a null model, and `turn.failed` as a run failure — D10,
      REQ-206, REQ-214, AC-232. Verify: same command, over a recorded event fixture.
- [x] 2.4 Emit one activity per tool item on the first sighting of its id, one event per path in a
      `file_change`, and none for `agent_message`/`reasoning`/`todo_list` — D8, REQ-212, AC-226,
      AC-227. Verify: same command; a stream reporting one item twice yields one event.
- [x] 2.5 Detect a session the CLI will not fork and rerun cold, recording the reason — AC-235.
      Verify: same command.
- [x] 2.6 `healthcheck` over `--version` and `login status`, distinguishing usable from expired from
      indeterminate and echoing no credential material — REQ-210, AC-220, AC-221. Verify: same
      command.

## 3. Holding both providers

- [x] 3.1 Replace `provider` with a `ProviderRegistry` on `StageExecutorDeps` and
      `ConversationExecutorDeps`, make `request.provider` required, and fail an unregistered
      provider with `provider_error` naming it — D5, REQ-215, AC-241, AC-242. Verify:
      `bun test packages/runner`.
- [x] 3.2 Move `cli`, `authVolume` and `forwardEnv` into a per-provider record on `RunnerConfig`,
      and carry the job's provider on `ExecSpec` — D6, REQ-508. Verify: same command.
- [x] 3.3 Mount the job's provider's auth volume in `DockerBackend`, forward only that provider's
      names, and apply the `GITHUB_` refusal per provider — D6, REQ-203, AC-520. Verify: same
      command; the argv for a Codex job names neither the Claude volume nor its forwarded name.
- [x] 3.4 `preflight` checks every configured provider's CLI and fails naming the provider and the
      CLI that is missing — REQ-508, AC-518. Verify: same command.

## 4. Configuration

- [x] 4.1 `AVAILABLE_PROVIDERS`, validated against the provider catalog and defaulting to
      `claude-code`; the orchestrator's `availableProviders` reads it instead of its literal — D10,
      REQ-508, AC-519. Verify: `bun test apps/orchestrator`.
- [x] 4.2 Rename `RUNNER_CLI`/`RUNNER_AUTH_VOLUME`/`RUNNER_FORWARD_ENV` to their per-provider forms,
      drop `RUNNER_MODEL`, and exit at startup naming each old variable and its replacement — D7,
      REQ-504. Verify: same command.
- [x] 4.3 Update `.env.example`, `docker-compose.yml` (the Codex volume and its `tools` login
      service) and `install.sh` (the `CODEX_VERSION` pin, the image label check, the Codex login
      step) — D12. Verify: `./install.sh --check`.

## 5. Dispatch

- [x] 5.1 `bindStageProvider` prefers the task's bound provider for the role instead of the role
      contract's default — D4, REQ-213, REQ-106. Verify: `bun run vitest run packages/core/test`.
- [x] 5.2 Resolve a stage's model after its provider in the dispatcher: the binding's model when the
      provider matches, that provider's default model for the role otherwise, effort carried
      unchanged — D4, REQ-112, AC-138. Verify: `bun test apps/orchestrator`.
- [x] 5.3 Build the registry in the orchestrator entry point and in `run-stage.ts`, and read the
      provider from the task's binding where `run-stage.ts` omitted it — D5. Verify: same command.
- [x] 5.4 Over two configured providers: a task whose implementation runs one and whose validation
      runs the other, each stage recording the provider it ran under, and a single-provider
      deployment still checking its own work — AC-240, AC-114, AC-115. Verify: same command.

## 6. Persistence

- [x] 6.1 Migration backfilling `provider` into every stored `tasks.model_bindings` and into the
      `model-defaults` setting, from each role's shipped default — REQ-303, REQ-313, AC-351,
      AC-352. Verify: `bun test packages/db`.
- [x] 6.2 Seed the provider in the model-defaults row on a fresh install, so no role is ever read
      without one — AC-336. Verify: same command.

## 7. Surfaces

- [x] 7.1 Accept a provider in the intake override and the settings update, rejecting an unknown
      provider and an incoherent pair by field — REQ-1001, REQ-1014, AC-1085, AC-1086. Verify:
      `bun test apps/api`.
- [x] 7.2 `ModelSelectPair` gains a provider select and offers only that provider's models; changing
      the provider leaves the role naming a model it offers — REQ-917, REQ-903, AC-1809, AC-1913.
      Verify: `bun run --cwd apps/web test`.
- [x] 7.3 Add the provider column to the Settings screen and the new-task override, and to the
      task view's rendering of what a role ran under — AC-946, AC-948. Verify: same command.
- [x] 7.4 Render the new part in `/kit` if `ModelSelectPair` gained a kit primitive; otherwise
      confirm it composes existing ones — repository convention. Verify:
      `bun run --cwd apps/web test`.

## 8. Close out

- [x] 8.1 `bun run ci` green.
- [ ] 8.2 Run one real task end to end against a repository with both providers configured, and
      check the stage rows record two different providers — AC-114, AC-240.
