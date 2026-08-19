## Why

Phase 5 of the roadmap (docs/plan.md §14, "Provider/model/reasoning-effort binding, not just
provider") calls out that `model` (and, once a role's provider is `claude-code`, its
`--effort` level) is currently one value for the whole runner **process** (`RunnerConfig.model`,
set once via the `RUNNER_MODEL` env var) — every role, on every task, runs the same model, and
changing it means editing an env var and redeploying. The plan ties this to the full
multi-provider effort (Codex/Copilot adapters, cross-provider review policy), which is separate,
later work with its own risk profile. The model and reasoning-effort half of that binding does
not need to wait: it is useful on its own, and today there is no way for the owner to run, say,
a cheaper/faster model at low effort for `summarizer` and a stronger one at high effort for
`spec_writer` without hand-editing config and restarting the orchestrator, let alone doing it
per task. This change pulls that slice forward as its own scoped piece of Phase 5, decoupled
from multi-provider execution, and gives the owner a UI surface to change it without touching an
env var — the first entry in what the plan and the owner both expect to become a general
Settings screen.

## What Changes

- A new `app_settings` key-value store (Postgres) holds a `model-defaults` row: one model and
  one reasoning effort per `AgentRole`. It is mutable at runtime through a new authenticated
  endpoint — no redeploy to change which model or effort level a role runs by default.
- Task creation (`task-surface` REQ-1001) accepts an optional per-role model and/or
  reasoning-effort override. At creation, each role's binding is resolved once — override, else
  the current `model-defaults` setting for that role, else the shipped hardcoded default — and
  the fully resolved map is stored on the task row (`tasks.modelBindings`), exactly the "resolved
  at creation, not merged at read time" rule already used for `caps`/`budgets`. A later change to
  the `model-defaults` setting never touches a task already created.
- `StageJob` (the runner's per-stage execution contract) gains `model` and `reasoningEffort`
  fields. The runner reads both from the job the orchestrator dispatches, not from
  `RunnerConfig`/`RUNNER_MODEL` — which becomes a code-level seed/fallback only, not the live
  source of truth. Different roles on the same task can now genuinely run different models at
  different effort levels.
- A fixed catalog of valid model IDs (`claude-opus-5`, `claude-sonnet-5`,
  `claude-haiku-4-5-20251001`, `claude-fable-5`) and reasoning-effort levels (`low`, `medium`,
  `high`, `xhigh`, `max` — the Claude Code CLI's own `--effort` values) ships in code — this
  change makes the **assignment** of a model and effort level to a role a live, owner-editable
  config; it does not make either catalog itself dynamic. A new model ID or effort level still
  ships as a code change.
- A hardcoded `DEFAULT_MODEL_BINDINGS` map (one model + effort per role) ships in code as the
  factory default — the seed for a fresh install's `model-defaults` row, the fallback if a role
  is ever missing from it, and the target of the Settings screen's reset action.
- A new Settings screen in the web client, reachable by URL like every other screen (REQ-901),
  showing the model-defaults editor — model and reasoning effort per role, plus a reset-to-default
  action — as its first (and for now only) section. Its information architecture is built so
  further settings (the plan and the owner both anticipate theme, among others) become new
  sections later, without restructuring the screen. This change does **not** add a theme setting
  — see Non-goals.
- The new-task form gains an optional, collapsed "override models for this task" control that
  submits the per-role model/effort override accepted by the intake endpoint above.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `persistence`: new `app_settings` key-value table; new `tasks.modelBindings` jsonb column,
  resolved and stored at creation the same way `caps`/`budgets` already are — now covering both
  model and reasoning effort per role.
- `agent-execution`: `StageJob` gains `model` and `reasoningEffort` fields; the runner dispatches
  the values recorded on the task's resolved `modelBindings` for the stage's role instead of
  reading a single process-wide config value.
- `task-surface`: task intake (REQ-1001) accepts an optional per-role model and/or
  reasoning-effort override; new endpoints read and update the `model-defaults` setting.
- `operator-ui`: REQ-901's four screens become five (Settings added), each still addressable by
  URL; a new requirement covers the Settings screen's model-defaults section (model, effort, and
  reset); the new-task form gains the optional per-role override control.

## Impact

- `packages/db`: new `app_settings` table + migration seeding its one `model-defaults` row from
  the shipped `DEFAULT_MODEL_BINDINGS`; `tasks.modelBindings` jsonb column + migration.
- `packages/core`: new model catalog (`ModelId`, `MODELS`), reasoning-effort catalog
  (`ReasoningEffort`, `REASONING_EFFORTS`), `DEFAULT_MODEL_BINDINGS`, and a `ModelBindings` zod
  shape (`Record<AgentRole, {model: ModelId, reasoningEffort: ReasoningEffort}>`), mirroring
  `Caps`/`Budgets` in `state.ts`/`budgets.ts`.
- `packages/runner`: `StageJob` gains `model` and `reasoningEffort`, threaded through
  `executor.ts`'s `StageRequest` and `conversation-executor.ts`'s `ConversationRequest`;
  `claude.ts`'s stage-dispatch call site passes `job.model`/`job.reasoningEffort` to the CLI's
  `--model`/`--effort` flags instead of `config.model` (its healthcheck call site is unchanged,
  having no task to resolve a binding from); `RunnerConfig.model`/`RUNNER_MODEL` remain only as
  the migration seed and a defensive fallback, no longer read at stage-dispatch time.
- `apps/orchestrator`: task creation resolves and stores `modelBindings` before the task's first
  stage dispatches; `index.ts`'s stage and conversation dispatchers resolve dispatch-time
  `model`/`reasoningEffort` from the task row the same way they already do for `environment`.
- `apps/api`: new settings endpoints; task intake validates the optional override.
- `apps/web`: new Settings screen and route (model, effort, reset-to-default per role);
  new-task form's override control.

## Non-goals

- No provider switching and no Codex/Copilot execution — every stage still runs `claude-code`;
  reasoning effort here is specifically the Claude Code CLI's own `--effort` levels, not a
  provider-agnostic concept. Full Phase 5 (multi-provider adapters, cross-provider review
  policy) is separate, later work.
- No theme setting or theme toggle. `operator-ui` REQ-909 ("One theme, canvas included") is
  untouched here; a real theme toggle would need to amend it and is a candidate for a later
  change once this one has established the Settings screen's shape.
- No dynamic model or reasoning-effort catalog and no per-provider model discovery — both lists
  are code-level constants, updated when a new model or effort level ships, same as `PROVIDERS`
  today.
- No retroactive re-resolution of `modelBindings` for existing tasks when the `model-defaults`
  setting changes — same rule already governing `caps`/`budgets`. The Settings screen's reset
  action changes the *setting*, not any already-created task.
- No generic settings CRUD framework. `app_settings` is a key-value table so a future setting is
  a new row, not a schema migration, but this change exposes only the one concrete
  `model-defaults` endpoint and UI section it needs — not a generic `/settings/:key` API.
