## Why

SpecMate has one provider. `ROLE_CONTRACTS` names `codex` as the default for the implementer, the
verifier and the reviewer; `bindStageProvider` reads that default, finds it missing from
`availableProviders`, and falls back to `available[0]`, which is `claude-code` because the
orchestrator hardcodes the list to that one entry. So the catalog's provider column is dead text,
and REQ-106 — the checking provider differs from the producing one whenever more than one is
configured — has never once selected a different provider. Every stage of every task runs the same
model family, and the shared blind spot the cross-provider rule exists to break is intact.

Nothing structural is missing. `AgentProvider` is already the whole surface an executor sees,
`StageJob` already carries the provider it is bound to, `stages.provider` already records what ran,
and the `provider` enum in the database has held `codex` since the first migration. What is missing
is a second implementation of that interface, a way to hold two of them at once, and a binding that
says which one a role runs under.

The binding is the part that is not mechanical. A per-role default today is a model and a reasoning
effort; a provider does not simply join them as a third independent field, because a model belongs
to a provider. `claude-opus-5` dispatched to `codex exec` is not a degraded run, it is a failed one,
and the cross-provider rule makes the collision routine rather than exotic: the checking node is
bound to a provider deliberately chosen to differ from the one the task's binding names, so the
binding's model is by construction the wrong provider's. This change is mostly about getting that
one rule right.

**Roadmap.** Phase 5 — Multi-provider (§14). It delivers that phase's core — the provider adapter
and the provider/model/reasoning-effort binding — and leaves its per-provider cost accounting to the
phase that has a price list to account against (see Non-goals).

## What Changes

- A **`codex` provider** implements `AgentProvider` over the official CLI's headless mode: the run,
  the structured activity stream, the session it leaves behind, the session it forks on a
  resumption, and the authentication check. It sits beside the Claude Code provider, neither aware
  of the other.
- **The provider joins the per-role binding.** A binding is a provider, a model, and a reasoning
  effort, resolved at creation from the owner's override and the stored defaults, exactly as the
  model and the effort already are. The setting, the intake override, the Settings screen and the
  new-task form all widen by one field.
- **A binding's model must be one its provider offers.** The model catalog becomes per provider.
  A binding pairing a provider with a model it cannot run is rejected where the binding is formed —
  intake and the settings update — naming the offending field.
- **Where a check flips the provider, the model follows the provider.** A node bound to check
  another's output runs under a provider deliberately different from the task's binding for that
  role; its model SHALL therefore be that provider's default for the role, never the model the
  binding names for the other provider.
- **An executor holds every configured provider, not one.** A stage runs under exactly the provider
  its job names; a job naming a provider the deployment does not run fails the stage saying so,
  rather than being silently served by whichever provider happened to be wired in.
- **The configured provider set is configuration.** It is validated at startup, and each configured
  provider names its CLI and keeps its own stored session, separate from every other provider's.
- **REQ-106 starts selecting.** With two providers configured, `bindStageProvider` gives every
  checking node a provider other than the writer's. No change to the rule; it simply has an
  alternative to choose for the first time.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-contracts`: a new requirement makes a binding's provider and model coherent, and states
  that a check's model follows the provider it is bound to rather than the binding it came from.
- `agent-execution`: REQ-213 gains the provider alongside the model and the reasoning effort; a new
  requirement holds a stage to the provider it was bound to and names what happens when the
  deployment does not run that provider.
- `persistence`: REQ-303 and REQ-313 carry the provider in the bindings they already carry, and both
  say what a record written before the provider was part of a binding resolves to.
- `service-topology`: a new requirement makes the set of providers a deployment runs into validated
  configuration, each with its own CLI and its own stored session.
- `task-surface`: REQ-1001 and REQ-1014 accept a provider in the override and the update they already
  accept, and reject a provider/model pair that cannot run.
- `operator-ui`: REQ-917's model-defaults section covers the provider per role.
- `launch-screen`: REQ-903's per-task override covers the provider per role.

## Non-goals

- **No planner-authored routing.** Which provider a role runs under stays a human-set default with a
  per-task override. A kickoff-time routing proposal is an extension of `kickoff-brief` for after
  this exists to extend.
- **No quota-aware routing.** There is no source of truth for remaining provider quota, so nothing
  here reads one. Phase 7's subscription accounting is where that acquires a source.
- **No per-provider cost accounting.** The Codex CLI reports token counts and no price. A stage that
  ran under it records a null cost, which `costComplete` already turns into "this sum is a floor"
  and REQ-1502 already keeps from reaching a cost budget. A wall-clock budget bounds such a task;
  a cost budget does not, and that is stated rather than papered over.
- **No copilot provider.** The third entry in the provider enum stays unimplemented. Two providers
  are what REQ-106 needs to stop being vacuous.
- **Two models from one provider are still one provider.** Whether that counts as an independent
  check is the open question REQ-106 deliberately leaves open; this change does not answer it.
- **No per-model reasoning-effort matrix.** The effort vocabulary is shared because both CLIs accept
  the same five words. That an individual model may not offer the deepest of them is the CLI's
  answer to give, not a table SpecMate maintains.
- **Tasks in flight are not re-bound.** A task carries the bindings it was created with, per REQ-303.

## Impact

- `packages/core/src/models.ts` — `MODELS` becomes a per-provider catalog, `ModelBinding` gains
  `provider`, and `resolveModelBindings` resolves the provider first so a model can be defaulted
  against it.
- `packages/core/src/roles.ts` — unchanged. `ROLE_CONTRACTS[…].defaultProvider` keeps its two
  readers: REQ-106's check that no checking node is bound to it, and the fallback for a caller with
  no task binding.
- `packages/core/src/pipeline.ts` — `bindStageProvider` takes the task's bound provider as the
  preference instead of reading the role contract.
- `packages/runner/src/codex.ts` (new) — the provider. `packages/runner/src/claude.ts` keeps its
  envelope reading; what the two share moves to a common module rather than being duplicated.
- `packages/runner/src/executor.ts`, `conversation-executor.ts` — one provider becomes a registry
  keyed by provider id.
- `packages/runner/src/config.ts`, `docker-backend.ts`, `local-backend.ts` — a CLI and an auth
  volume per provider; the exec spec carries the provider whose session to mount.
- `apps/orchestrator/src/runner.ts`, `index.ts`, `dispatch.ts`, `engine.ts` — the configured
  provider set, the registry, and resolving a stage's model after its provider.
- `packages/db` — a migration backfilling the provider into stored bindings and stored defaults.
- `apps/api/src/routes/schemas.ts`, `settings.ts`, `tasks.ts` — the provider in the override and the
  update, and the coherence check.
- `apps/web/src/components/model-select-pair.tsx` and its two callers — a provider select, with the
  model select offering only that provider's models.
- `runner/Dockerfile`, `docker-compose.yml`, `.env.example` — the second CLI, pinned, and its volume.
