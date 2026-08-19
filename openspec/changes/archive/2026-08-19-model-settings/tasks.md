## 1. Core model + reasoning-effort catalog and bindings shape

- [x] 1.1 Add `MODELS`/`ModelId`, `REASONING_EFFORTS`/`ReasoningEffort` (zod enums — effort is
      the Claude Code CLI's own `--effort` values: `low`, `medium`, `high`, `xhigh`, `max`,
      confirmed via `claude --help`) to `packages/core/src/models.ts`. Add
      `DEFAULT_MODEL_BINDINGS: ModelBindings` — every `AgentRole` at
      `{ model: 'claude-opus-5', reasoningEffort: 'high' }` (`model` matches today's
      `DEFAULT_RUNNER_CONFIG.model`, `packages/runner/src/config.ts:55`, so the migration stays
      behavior-preserving on the model dimension; there is no prior effort behavior to preserve).
      Change `ModelBindings` to
      `z.record(AgentRole, z.object({ model: ModelId, reasoningEffort: ReasoningEffort }))`.
- [x] 1.2 Update `resolveModelBindings(defaults, override?)` to resolve `model` and
      `reasoningEffort` independently, per field, per role — `override[role]?.model ??
      defaults[role]?.model ?? DEFAULT_MODEL_BINDINGS[role].model`, same shape for
      `reasoningEffort` — so an override naming only one field for a role still inherits the
      other field from that role's current default.
- [x] 1.3 Update the unit tests: full override (both fields), a field-only override (model
      named, effort not, and vice versa), empty override, a role missing from `defaults`
      falling back to `DEFAULT_MODEL_BINDINGS[role]` for both fields independently.

## 2. Persistence (REQ-303, REQ-313)

- [x] 2.1 `app_settings` table is unchanged (already shipped) — no new migration needed for the
      table shape itself, only for what `tasks.modelBindings`'s column default and the seed row
      now contain.
- [x] 2.2 Regenerate the Drizzle migration for `tasks.modelBindings`'s default now that
      `resolveModelBindings({})` returns the `{model, reasoningEffort}` shape (AC-305/AC-333
      semantics preserved for `model`; every task now gets a concrete `reasoningEffort` too).
      Nothing has been deployed against the pre-change schema, so this ships as one squashed
      migration rather than a schema-plus-backfill pair — there are no pre-existing rows to
      migrate.
- [x] 2.3 Update the seed migration's `model-defaults` row to the new per-role
      `{model, reasoningEffort}` shape (AC-336).
- [x] 2.4 `packages/db`'s settings-store helpers are mechanically unchanged (still one get, one
      partial-merge update against the `model-defaults` key) — only the `ModelBindings` type
      they move changes shape.
- [x] 2.5 Extend the restart-persistence test to assert both fields survive (AC-335).

## 3. Task creation resolves and stores bindings (REQ-303/AC-333, AC-334; task-surface REQ-1001)

- [x] 3.1 `apps/orchestrator`'s `createTask` is mechanically unchanged (still reads current
      `model-defaults` inside the transaction and calls `resolveModelBindings`) — verify it
      still compiles once the shape carries `reasoningEffort` too.
- [x] 3.2 Extend the intake validation schema: the per-role override becomes
      `Partial<Record<AgentRole, Partial<{ model: ModelId, reasoningEffort: ReasoningEffort }>>>`
      — rejecting an unknown role, an unknown model, or an unknown reasoning effort, naming the
      offending field (AC-1039).
- [x] 3.3 Extend the "no override" test to assert the stored bindings carry the then-current
      default `reasoningEffort` too, and that a later default change (either field) does not
      alter an already-created task (AC-333, AC-334).
- [x] 3.4 Extend the one-role-override test to also cover an effort-only override (model
      untouched, inherits the current default) and a model-only override (effort untouched)
      (AC-1038).

## 4. Stage dispatch reads the resolved binding (agent-execution REQ-213)

- [x] 4.1 Add `reasoningEffort: ReasoningEffort` to `StageJob` (`packages/core/src/provider.ts`),
      alongside the existing `model` field.
- [x] 4.2 Add `reasoningEffort: ReasoningEffort` to `StageRequest`
      (`packages/runner/src/executor.ts`) and `ConversationRequest`
      (`packages/runner/src/conversation-executor.ts`), copied onto the constructed `StageJob`
      the same way `model` already is.
- [x] 4.3 `apps/orchestrator/src/index.ts`'s `dispatcher`, `conversationDispatcher`, and
      `run-stage.ts` resolve `reasoningEffort` from the task row the same way they now resolve
      `model` — `current?.modelBindings?.[role].reasoningEffort` (stage path),
      `current?.modelBindings?.answerer.reasoningEffort` (conversation path).
- [x] 4.4 `packages/runner/src/claude.ts`: `argv(role, model)` gains a `reasoningEffort:
      ReasoningEffort` parameter and pushes `--effort`, `reasoningEffort` onto the argv array.
      Both call sites inside `run()` pass `job.reasoningEffort`. The `checkSession()` healthcheck
      call site omits `--effort` entirely — same "no task, no binding to resolve" reasoning as
      `--model` there. Update `claude.test.ts`'s `job()`/`.argv(...)` fixtures to carry a
      reasoning effort.
- [x] 4.5 Confirm nothing on the stage- or conversation-dispatch path reads a process-level
      effort value (there is none to read — grep confirms `--effort` only appears at the
      stage-dispatch call site).
- [x] 4.6 Extend the "dispatches the model resolved on the request" executor test to also assert
      two stages dispatch with different `--effort` values, and that the dispatched effort
      matches the task's stored binding regardless of any process-level model default (AC-230,
      AC-231).

## 5. Settings REST surface (task-surface REQ-1014)

- [x] 5.1 `GET /settings/model-defaults` response shape carries `{model, reasoningEffort}` per
      role (AC-1040) — route logic unchanged, only the value's shape changes.
- [x] 5.2 `PUT /settings/model-defaults` accepts a partial per-role, per-field update (model
      and/or reasoningEffort), rejecting an unknown role, model, or reasoning effort naming the
      offending field (AC-1042), returning the merged result (AC-1041).
- [x] 5.3 Extend the integration test: `PUT` a new reasoning effort for one role (model
      untouched), then a task created afterward without an override for that role picks up both
      the current model and the new effort (AC-1041 end-to-end).

## 6. Settings screen (operator-ui REQ-917)

- [x] 6.1 Model Defaults section gains a second dropdown per role — reasoning effort over the
      fixed `REASONING_EFFORTS` catalog — alongside the existing model dropdown.
- [x] 6.2 Add a "Reset to defaults" action to the section: on click, `PUT` the full
      `DEFAULT_MODEL_BINDINGS` (imported from `@specmate/core`, the same constant the migration
      seed and the resolution fallback use) as the request body — every role named, so every
      role resets in one save (AC-949).
- [x] 6.3 Test/verify: changing a role's default model or effort in the UI and saving is
      reflected on the next task created without an override for that role (AC-946); the
      Settings URL loads directly in a fresh browser without going through the inbox (AC-947);
      triggering reset after changing several roles restores all of them to
      `DEFAULT_MODEL_BINDINGS` (AC-949).

## 7. New-task form override control (operator-ui REQ-903)

- [x] 7.1 The collapsed override control gains a second dropdown per role — reasoning effort —
      alongside the existing model dropdown, both defaulting to "Use default".
- [x] 7.2 Wire submission so a role's override carries whichever of `model`/`reasoningEffort`
      the owner actually touched (not both, unless both were touched) in the create request's
      `modelBindings`.
- [x] 7.3 Test: expanding the control, overriding one role's effort only (model left at "Use
      default"), and submitting sends `{ reasoningEffort }` for that role without a `model` key;
      the created task's view shows the overridden effort for that role (AC-948).

## 8. Verification

- [x] 8.1 `bun run spec:lint` and `openspec validate model-settings --strict` pass.
- [x] 8.2 `bun run spec:validate` (repo-wide) passes.
- [x] 8.3 Create a task with one role's reasoning effort overridden (model left at default) via
      a real request against a throwaway Postgres + the API process, confirm the stored bindings
      reflect the override; confirm the "Reset to defaults" `PUT` round-trips through the real
      API back to `DEFAULT_MODEL_BINDINGS`.
