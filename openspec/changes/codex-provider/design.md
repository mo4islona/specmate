## Context

See proposal.md — Why. What shapes the approach is how much of the seam is already cut.

`AgentProvider` is three members: an id, `run(job)`, `healthcheck()`. `StageJob` already carries
`provider`, `model` and `reasoningEffort`; `StageOutcome` already carries `sessionId`,
`coldStartReason` and a `StageTelemetry` whose fields are documented as "null, never zero". The
`stages` table already has a `provider` column, and the `provider` enum has held `codex` since
migration 0000. `StageExecutor` and `ConversationExecutor` each already refuse a job whose
`provider` differs from theirs — the refusal exists precisely because there was one day meant to be
more than one of them.

So the shape of the work is: a second implementation, a way to hold both, and a binding that says
which. Three constraints fall out of the existing machinery.

**The binding is per role and resolved at creation.** `ModelBindings` is
`Record<AgentRole, {model, reasoningEffort}>`, stored on `tasks.model_bindings` and on the
`model-defaults` app setting, resolved per field by `resolveModelBindings(defaults, override)`.
Anything the provider does has to fit that resolution, including its "a field-only override inherits
the other field from that role's current default" rule.

**A model belongs to a provider.** `ModelId` is a closed enum of four Claude models. The Codex CLI
takes `-m <slug>` from its own catalog. There is no model both accept.

**A checking node's provider is decided at dispatch, not at creation.** `bindStageProvider` gives a
node whose binding is `cross_review` a provider that differs from the one that wrote the artifacts
under review — a decision made when the task reaches the node, from a `stages` row. The task's
stored binding cannot know it.

The Codex CLI's headless surface, as it actually behaves (`codex-cli` 0.150.1):

- `codex exec --json -` reads the prompt from stdin and prints JSONL events to stdout.
- The events are `thread.started` (carrying `thread_id`), `turn.started`, `item.started`,
  `item.updated`, `item.completed`, `turn.completed` (carrying `usage`), `turn.failed`.
- An item is one of `agent_message`, `reasoning`, `command_execution`, `file_change`,
  `mcp_tool_call`, `web_search`, `todo_list`, `error`.
- `codex exec fork <session-id> -` continues a recorded session into a new one, under a **narrower
  flag set** than `exec`: it rejects `--color` and `-s/--sandbox` outright, exiting 2 before it
  starts. Verified against the CLI, not assumed — a flag it will not take turns every resumption
  into a stage failure.
- A fork it will not make exits 1 with `Error: thread/fork: thread/fork failed: no rollout found for
  thread id <id>` on stderr, and opens no thread. The wording matters: "no rollout found" is not
  "not found", so a matcher written from the obvious guess misses it and the run fails instead of
  starting cold.
- A successful fork reports a **new** `thread_id`, which is what makes it a fork rather than an
  append (AC-236), and the model answers from the forked turns.
- `usage` is `{input_tokens, cached_input_tokens, cache_write_input_tokens, output_tokens,
  reasoning_output_tokens}`. There is no cost and no model in the envelope.
- `codex login status` reports whether the stored credential is usable, without running a turn.
- Reasoning effort is `-c model_reasoning_effort=<level>`, and the levels the shipped models accept
  are `low|medium|high|xhigh|max` — the same five words as `REASONING_EFFORTS`.

## Goals / Non-Goals

**Goals:**

- One place decides what provider a stage runs under, and the model is derived from that decision
  rather than carried past it.
- The two providers know nothing about each other; what they share is factored out, not inherited.
- A deployment that configures one provider behaves exactly as it does today.
- Every widening of what a stage can reach — a second CLI, a second credential — is scoped to the
  stage that needs it, so REQ-203 keeps meaning what it says.

**Non-Goals:**

- A general plugin surface for providers. Two implementations do not need a registry format; a map
  from a closed enum is the whole mechanism.
- Normalising the two CLIs' telemetry into one currency. Tokens under the provider's own keys is
  what `StageTelemetry` already promises, and it is what both give.
- Teaching `editFor` to reconstruct a Codex edit — see D8.

## Decisions

### D1 — The provider joins `ModelBinding`, rather than getting a column of its own

The plan sketched a separate `providerBindings` column beside `caps`/`budgets`. Rejected: the three
fields are one decision. A provider without a model it can run is not a binding, and two columns
would put the coherence rule between them, to be re-established by every writer and re-checked by
every reader.

The cost the separate column was avoiding — a migration — is not real here. `model_bindings` is
`jsonb`, so the field is added by backfilling values, not by altering a type. The Settings screen
already edits a pair per role and becomes a triple in the same row.

`ModelBinding` becomes `{provider, model, reasoningEffort}`, and `ModelBindings` stays
`Record<AgentRole, ModelBinding>`.

### D2 — The model catalog splits per provider; the effort vocabulary does not

`MODELS` becomes `PROVIDER_MODELS: Record<ProviderId, readonly string[]>`, with `ModelId` a closed
enum over the union of every provider's catalog. A closed union keeps every existing parse site
honest — an unknown model is still rejected at intake — while `PROVIDER_MODELS` is what answers
"may this provider run it".

The reasoning effort stays one shared enum. Both CLIs accept `low|medium|high|xhigh|max`; splitting
a vocabulary that does not differ would add a second table to keep in step for nothing. That an
individual Codex model may not offer `max` is left to the CLI to answer: SpecMate maintaining a
per-model matrix would be maintaining a copy of a catalog that changes without it.

`DEFAULT_MODEL_BINDINGS` binds every role to the shipped provider's default model — see D13 for why
it is not the role catalog's own.

### D3 — `resolveModelBindings` resolves the provider first, and defaults the model against it

The existing rule is per-field: override wins, else the passed-in default, else the factory default.
Kept for the provider. But the model can no longer be resolved independently, because the winning
provider decides which models are admissible.

So the order is: resolve the provider; then resolve the model, taking the override's model if there
is one, else the default's model *if that provider offers it*, else that provider's default model
for the role. An owner who switches one role to `codex` and names no model gets a Codex model, not
a rejection and not `claude-opus-5`.

An override naming a provider **and** a model that provider cannot run is a different case: it is
not underspecified, it is wrong, and it is rejected at the edge that accepted it — intake and the
settings update — naming the field. Silently correcting an explicit pair would be the API deciding
the owner meant something else.

### D4 — When a check flips the provider, the model follows the provider

This is the decision the rest of the change exists to support.

`bindStageProvider` gives a `cross_review` node a provider chosen to differ from the writer's. Until
now that never changed anything, because there was one provider. With two, the node's provider is
routinely *not* the one the task's binding names for its role — and the binding's model is therefore
routinely the other provider's.

Dispatch therefore resolves in this order, per stage, every time:

1. the provider, from `bindStageProvider(node, writer, configured)`, preferring the task's bound
   provider for that role rather than the role contract's default;
2. the model, from the task's binding when the resolved provider is the one it names, and otherwise
   that provider's default model for the role;
3. the reasoning effort, from the binding unconditionally — it is provider-independent by D2.

Two alternatives were considered and rejected. Storing a model per (role, provider) pair on the task
would make the binding a matrix the owner has to fill in for providers their task may never use.
Failing the stage when the bound model does not match the resolved provider would turn REQ-106 —
which is supposed to hold by default — into a configuration that fails by default.

The consequence is stated rather than hidden: a checking stage does not run the model the owner
picked for that role. It cannot; the owner picked a model for a different provider. What the owner
picked governs everywhere the provider is theirs.

### D5 — One registry, resolved per job; the mismatch refusal generalises rather than disappears

`StageExecutorDeps.provider: AgentProvider` becomes `providers: ProviderRegistry`, a
`ReadonlyMap<ProviderId, AgentProvider>`; the same for `ConversationExecutorDeps`. `execute` looks up
`request.provider` and fails the stage with `provider_error` naming it when the deployment does not
run it.

`request.provider` stops being optional. It is optional today because there was one provider and a
caller could omit it; with two, an omitted provider is a caller that forgot, and the executor would
have to pick — which is the decision D4 just placed at dispatch. The one caller that omits it today
(`run-stage.ts`) reads it from the task's binding like every other caller.

### D6 — A provider's stored session gets its own volume, selected by the job

`DockerBackend` mounts `config.authVolume` at `config.homeDir` for every run. Codex keeps its
credential in `$CODEX_HOME`, which defaults to `$HOME/.codex`, so one shared home would work — and
would put every provider's credential inside every stage. REQ-203 says a stage reaches its own
working tree and "the provider's stored authentication", singular.

So `ExecSpec` gains the job's provider, and the backend mounts that provider's volume. `RunnerConfig`
grows a per-provider record:

```
providers: { [id]: { cli, authVolume, forwardEnv } }
```

`forwardEnv` moves inside for the same reason the volume does: `RUNNER_FORWARD_ENV` is how a
credential reaches a stage by name, and a flat list forwards both providers' credentials into every
stage. The `GITHUB_`-prefix refusal is applied per provider, unchanged in substance.

The in-process backend keeps using the developer's own `HOME`, where both CLIs' sessions are the
developer's own. Nothing to select there; only `preflight` changes, to check every configured
provider's CLI rather than one.

### D7 — `RUNNER_CLI`, `RUNNER_AUTH_VOLUME` and `RUNNER_FORWARD_ENV` are renamed, and the old names fail startup

Those three are the provider-specific members of the `RUNNER_*` family; the rest (`RUNNER_BACKEND`,
`RUNNER_IMAGE`, `RUNNER_CPUS`, `RUNNER_MEMORY`, `RUNNER_TOOLCHAINS_VOLUME`) genuinely are not. Under
D6 they become `CLAUDE_CODE_CLI` / `CLAUDE_CODE_AUTH_VOLUME` / `CLAUDE_CODE_FORWARD_ENV`, with
`CODEX_*` counterparts.

Keeping the unsuffixed names as aliases for claude-code was rejected: it leaves the configuration
asymmetric forever, and the asymmetry is exactly the thing a reader would have to already know.
REQ-504 gives the alternative — a startup that names every offending variable — so a deployment
carrying the old names exits naming each one and its replacement rather than starting with a
silently ignored setting. There is one deployment and its `.env` is under the owner's hand.

`RUNNER_MODEL` is dropped outright. REQ-213 already forbids process configuration from overriding a
resolved binding, and the only thing still reading it is the Claude provider's own session check,
which takes that provider's default model instead.

### D8 — One activity event per Codex item, on the first of `started`/`completed`, and no edit

The Codex CLI reports a tool item twice — `item.started` when it begins and `item.completed` when it
ends — so relaying both would double every line of the timeline. Emitting on the first sighting of
an item id gives the earliest signal and is stable against an item that only ever completes, which
is how `agent_message` arrives.

`file_change` names the paths it touched and their kind (`add`/`delete`/`update`) and carries neither
the text replaced nor the text replacing it. There is nothing to reconstruct an edit from: the file
on disk is the *after*, and the before is not recoverable from the event. Diffing against the last
commit would report the accumulated change of the whole stage on every event, attributing earlier
edits to the latest one.

So a Codex file-change activity carries its tool and its target and no `edit`, which is what
REQ-212's degradation clause already provides for ("a tool whose input does not carry an edit …
SHALL yield the event without the part that could not be established"). One event is emitted per
path in `changes`, because the target of an activity is one thing.

`agent_message`, `reasoning` and `todo_list` are read and discarded, per AC-227: they are the model
talking, not a tool use.

### D9 — Codex's own sandbox and repository check are bypassed; the container and the scope check are the boundary

The stage runs `--dangerously-bypass-approvals-and-sandbox`, which is the same posture as
`--permission-mode bypassPermissions` for Claude Code and for the same reason: nobody is present to
answer a prompt, and the isolation is the container, not the CLI's opinion.

The CLI's own repository check goes the same way, and here it is not a choice. A stage runs in a
git worktree whose `.git` is a *file* pointing into the repository's mirror, and the stage container
mounts the worktree and nothing else — so the mirror is absent, every git command inside the
container fails, and a CLI that refuses to start outside a repository would refuse every stage.
`--skip-git-repo-check` is therefore required, not a convenience. What that check protects is a
human's untracked files; what protects these is the container and the scope check.

One thing is genuinely lost. A role that may not write product code runs Claude Code with
`--disallowedTools Bash` — defence in depth, as that function's own comment says, on top of the
post-run `checkWriteScope`. The Codex CLI has no per-tool disallow, so that layer has no counterpart
and such a role under Codex is bounded by the scope check alone. The scope check is the enforcement
point under both providers and is unchanged; what differs is that under Codex it is also the only
one. Recorded here rather than discovered later.

### D10 — The configured provider set is configuration, not a healthcheck result

`AVAILABLE_PROVIDERS` is a validated list, and it is what `bindStageProvider` reads.

Deriving it from `healthcheck()` was rejected. Auth expires mid-task; a set derived from auth state
would change under a running task, so a checking node would bind to one provider on its first attempt
and another on its retry, and the cross-provider property would hold or not depending on when the
credential lapsed. Whether a provider's stored session is usable stays REQ-210's separate question,
with its own `provider_credentials` row.

### D11 — What the two providers share is factored out, not inherited

`readSessionId`, `parseEnvelope`, `readStageTelemetry` and `parseActivityLine` in `claude.ts` are all
shaped by the Claude Code CLI's `stream-json`: a terminal line of `type: "result"`, `session_id` on
any line, `modelUsage` keyed by model. None of it describes Codex's events.

What the two genuinely share is the part that is not the CLI at all: writing the prompt to scratch,
removing a stale `RESULT.json` before the run, reading and parsing it after, the
`checkReviseHasFindings` guard, writing `run.log` and `telemetry.json`, and the shape of
`StageRunError`. That moves to a module both import. Each provider keeps its own argv, its own
event parsing, and its own healthcheck.

A base class was rejected: the two differ in the parts a base class would have to leave abstract and
agree on the parts it would not, which is a free function's job.

### D12 — The image carries both CLIs; the login flow is per provider

One runner image with both CLIs pinned as build args, rather than an image per provider. The image is
the pin (REQ-802) and a per-provider image would double every toolchain install and make a task's
pinned environment depend on which provider each of its stages happened to bind.

The one-time interactive login keeps its existing shape — a compose service in the `tools` profile
that mounts the auth volume and runs the CLI — with a second service for the second volume.

### D13 — The factory binding names the shipped provider; the role catalog keeps the preference

`DEFAULT_MODEL_BINDINGS` binds every role to `SHIPPED_PROVIDER`, not to
`ROLE_CONTRACTS[role].defaultProvider`.

Seeding from the role catalog was tried first, on the reasoning that it is what makes that column
live. It breaks the Settings screen's reset: the reset action saves the shipped defaults, and on a
deployment configuring one provider three of those roles would name a provider it does not run —
which the settings update refuses, correctly. A factory default the shipped configuration cannot
satisfy is not a default.

Nothing is lost. `ROLE_CONTRACTS[role].defaultProvider` is still what REQ-106's AC-135 reads — no
checking node may be bound to its role's default — and still the fallback for a caller with no task.
And the value of a second provider does not come from the seed anyway: with two configured,
`bindStageProvider` flips every checking node away from the writer with no Settings edit at all. An
owner who wants the implementer on the other provider says so once, in the place made for saying it.
