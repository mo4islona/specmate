## Context

See proposal.md for motivation. Current state, precisely:

- `packages/runner/src/config.ts`: `RunnerConfig.model` is one string
  (`DEFAULT_RUNNER_CONFIG.model = 'claude-opus-5'`), sourced from the `RUNNER_MODEL` env var
  (`apps/orchestrator/src/runner.ts`), used for every role on every task. There is no
  `RunnerConfig` field for reasoning effort at all today — the CLI runs at its own default when
  `--effort` is omitted.
- `claude --help` confirms the flag this design binds to: `--effort <level>` accepting exactly
  `low, medium, high, xhigh, max` — a closed, CLI-defined set, not something SpecMate invents.
- `packages/runner/src/claude.ts:53,194`: the CLI invocation passes `config.model` directly to
  `--model`, with no `--effort` flag at all — line 53 inside `argv()`, called from the
  stage-dispatch path (`run()`, line 77); line 194 inside `checkSession()`, the provider
  healthcheck probe, which has no task or `StageJob` in scope.
- `packages/core/src/provider.ts` `StageJob`: already has `role: AgentRole` and
  `provider: ProviderId` per stage; no `model` field yet. `StageJob` is never built in
  `apps/orchestrator` — the orchestrator builds `StageRequest` (`packages/runner/src/
  executor.ts`) or `ConversationRequest` (`packages/runner/src/conversation-executor.ts`), and
  each executor copies its request's fields onto the `StageJob` it constructs internally
  (`executor.ts` `attempt()` ~line 151, `conversation-executor.ts` `execute()` ~line 105). The
  `answerer` role dispatches through the conversation path, not the pipeline stage path — it is
  a second, independent `StageJob` construction site.
- `packages/core/src/roles.ts` `ROLE_CONTRACTS`: already has a per-role `defaultProvider`, but
  it is a compile-time constant — not what "a task can override" needs when the *default itself*
  must also be owner-editable at runtime, per the proposal.
- `packages/db/src/schema.ts` `tasks.caps` / `tasks.budgets`: the exact "resolved at creation,
  not merged at read time" pattern this change reuses for `modelBindings`.
- No settings store of any kind exists in the schema today.

## Goals / Non-Goals

**Goals:**
- A role's default model and reasoning effort are owner-editable at runtime, no redeploy.
- A task's per-role models and reasoning efforts are fixed the moment it is created and never
  drift when the default changes later.
- The runner dispatches per-stage, not per-process — two roles on the same task can run
  different models at different effort levels today, without waiting for multi-provider work.
- The owner can always get back to a known-good configuration in one action, without having to
  remember or re-type what the shipped defaults were.

**Non-Goals:**
- Not designing the multi-provider `providerBindings` shape from Phase 5 — `provider` stays
  fixed at `claude-code`; only `model` and `reasoningEffort` are owner-editable here. Extending
  this later to also carry a provider dimension is expected, but this design does not pre-build
  for it beyond the natural fact that all three would live on the same per-role,
  resolved-at-creation shape.
- Not building a generic settings CRUD API. `app_settings` is a key-value table so a future
  setting is a new row and a new small endpoint, not a schema migration — but this change wires
  up exactly one key, `model-defaults`.

## Decisions

**Settings storage: a key-value table, not fixed columns.**
`app_settings(key text primary key, value jsonb not null, updated_at timestamptz not null)`.
Alternative considered: a single fixed-shape `settings` row (one column per setting). Rejected
because the proposal's stated context is an owner who explicitly wants more settings later
(theme, etc.) — a KV table means each future setting is one row, never a migration, which is
the concrete reason this shallow generality is justified rather than premature. The API and UI
still expose only the one concrete `model-defaults` key this change needs; nothing generic is
built past the storage shape itself.

**Model and reasoning-effort catalogs are code-level closed sets, not database tables.**
`packages/core` gets a new `ModelId` zod enum over the known model IDs (currently
`claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5-20251001`, `claude-fable-5`) and a
`ReasoningEffort` zod enum over the CLI's own `--effort` values (`low`, `medium`, `high`,
`xhigh`, `max`). `ModelBindings = z.record(AgentRole, z.object({ model: ModelId, reasoningEffort:
ReasoningEffort }))`, mirroring `Caps`/`Budgets` in `state.ts`/`budgets.ts`. A new model or
effort level shipping is still a code change (a new CLI version, new pricing, new capabilities
to evaluate) — what becomes a config is which known model and effort level a role runs, not the
universe of valid values. The Settings UI renders both fixed lists as a pair of dropdowns per
role; the intake and settings-update endpoints validate against them with `.safeParse`.

**A hardcoded `DEFAULT_MODEL_BINDINGS` map is the one factory default, doing three jobs.**
`packages/core` ships `DEFAULT_MODEL_BINDINGS: ModelBindings` — one `{model, reasoningEffort}`
pair per `AgentRole`, every role at `{ model: 'claude-opus-5', reasoningEffort: 'high' }` (`high`
chosen as a reasonable default until the owner tunes it; `model` matches today's
`DEFAULT_RUNNER_CONFIG.model` so the migration is behavior-preserving for the model dimension —
there was no prior effort behavior to preserve, since the CLI had no `--effort` flag call site
before this change). It is: (1) the migration's seed for `app_settings['model-defaults']`, (2)
the fallback `resolveModelBindings` reaches for a role that is somehow still missing from the
settings row, and (3) the Settings screen's reset target — the owner asked for a one-action way
back to a known-good configuration, and reusing the same map that already anchors (1) and (2)
means "reset" has no separate value to keep in sync.

**Resolution happens once, at task creation, in the orchestrator — never at dispatch time.**
Mirrors `caps`/`budgets` exactly: on create, for every `AgentRole`, resolve
`override[role] ?? currentModelDefaults[role] ?? DEFAULT_MODEL_BINDINGS[role]` (the last term
only reachable if the settings row were somehow missing a role, which the seed migration
prevents) — independently per field, so an override naming only `model` for a role still
inherits that role's current default `reasoningEffort`, and vice versa — and store the complete
map on `tasks.modelBindings`. `StageJob.model`/`StageJob.reasoningEffort` are then a plain
lookup — `task.modelBindings[stage.role]` — no config or settings read on the hot dispatch path,
and no risk of a mid-task settings edit silently changing a model or effort level between two
stages of one task.

**`RunnerConfig.model`/`RUNNER_MODEL` survive only as the migration seed and a defensive
fallback**, never read at stage-dispatch time once this ships. There is no equivalent
`RUNNER_EFFORT` env var to preserve — reasoning effort had no process-level knob before this
change, so `DEFAULT_MODEL_BINDINGS` is reasoning effort's only fallback, not a second env var.
`claude.ts`'s stage-dispatch call site switches from `config.model` to `job.model` and adds
`--effort job.reasoningEffort`; its provider-healthcheck call site (`checkSession()`, unrelated
to any task) keeps reading `config.model` and omits `--effort` entirely — there is no binding to
resolve without a task, and the CLI's own default is an acceptable answer for a bare
auth/session probe. Keeping the env var (rather than deleting it) means a fresh install still
gets a sane, single answer for "what model do the seeded defaults use" without requiring a
Settings-page visit before the first task can run.

**Settings API is two endpoints, not REST-over-`/settings/:key`.**
`GET /settings/model-defaults`, `PUT /settings/model-defaults` (partial update per role, per
field — naming only `model` for a role leaves that role's `reasoningEffort` untouched — merged
into the stored row). A generic `/settings/:key` surface was considered and rejected: it would
need to describe, per key, its own value schema and validation to be safe, which is exactly the
generic-framework complexity the proposal's non-goals reject building now. Adding the next
setting later means adding its own small pair of routes against the same table, which is cheap
enough not to need generalizing in advance. The reset action is not a third endpoint: the
client sends `DEFAULT_MODEL_BINDINGS` (which it already imports from `@specmate/core`, the same
constant the server-side seed and fallback use) as a full-map `PUT`, so the existing partial-merge
update does the work — every role is named, so every role resets.

**Settings screen: one screen, sectioned, first section is Model Defaults.**
No new routing concept beyond what the other four screens already use (REQ-901). The section
boundary is a plain UI convention (a heading + a card per section), not a data-modeled concept —
nothing in `app_settings` needs to know about UI sections, since the table is already
per-setting-key. The reset action is a single button in that section, not a new section of its
own.

## Risks / Trade-offs

- **Two sources of "default"** (the settings row and `DEFAULT_RUNNER_CONFIG.model`/
  `DEFAULT_MODEL_BINDINGS`) could drift into confusion → Mitigated by scope: the process-level
  constant is reachable only as the migration seed, and REQ-213/AC-231 make it a spec-checked
  invariant that a resolved task binding always wins over it.
- **A stale dropdown** if the model or effort catalog changes (a model retired, an effort level
  removed) while old tasks still reference it in their stored `modelBindings` → Not a new
  problem class: `tasks.caps`/`tasks.budgets` already carry values that can outlive the current
  defaults (AC-306's own premise). A task's stored binding is historical record, not a live
  pointer; retiring a value from either catalog only affects future creation and future Settings
  edits.
- **Reset silently discarding tuned defaults** the owner forgot they had set → Accepted: the
  action is explicit (a labeled button, not something reached by accident), and it only touches
  the *setting* — every already-created task keeps the bindings it was created with (AC-334),
  same guarantee that already covers any other settings edit.
- **`high` as the shipped default effort is a judgment call, not a measured one** — no usage data
  exists yet to justify a per-role default (e.g. `low` for `summarizer`, `max` for
  `implementer`). Accepted for this change: `DEFAULT_MODEL_BINDINGS` gives every role the same
  starting point, and the owner tunes per-role effort from Settings once they have a sense of
  where it matters — the mechanism (owner-editable, no redeploy) is this change's point, not the
  starting values.
- **Settings write races** (two browser tabs saving different roles at once) → Out of scope:
  SpecMate is explicitly single-owner (README, docs/plan.md); last-write-wins on the KV row is
  acceptable the same way it already is for every other owner-only mutation in this system.

## Migration Plan

1. `packages/core`: add `ModelId`, `MODELS`, `ReasoningEffort`, `REASONING_EFFORTS`,
   `DEFAULT_MODEL_BINDINGS`, `ModelBindings`.
2. `packages/db`: migration adds `app_settings` and `tasks.modelBindings` (jsonb, not null,
   default `DEFAULT_MODEL_BINDINGS`) and seeds `app_settings['model-defaults']` with the same
   value. Nothing has ever been deployed against this schema, so the migration ships as a single
   squashed step rather than schema-then-backfill — there is no pre-existing row whose
   `modelBindings` needs migrating.
3. `packages/runner`: add `model`/`reasoningEffort` to `StageJob`, `StageRequest`, and
   `ConversationRequest`; `claude.ts`'s stage-dispatch call site reads `job.model`/
   `job.reasoningEffort` (its healthcheck call site keeps `config.model`, no `--effort`).
4. `apps/orchestrator`: task creation resolves `modelBindings` before insert; `index.ts`'s stage
   and conversation dispatchers resolve `model`/`reasoningEffort` from the freshly re-read task
   row before calling their executor, the same way they already do for `environment`.
5. `apps/api`: `GET`/`PUT /settings/model-defaults`; intake validates an optional override.
6. `apps/web`: Settings screen + route (model, effort, reset-to-default); new-task form's
   collapsed override control.

No rollback complexity beyond a normal migration revert: nothing downstream depends on
`modelBindings` existing before this ships, and reverting the column/table drop is safe because
`claude.ts` and task creation would simultaneously revert to reading `RunnerConfig.model`.
