## Why

SpecMate's central bet is that agent *roles* are fixed and agent *providers* are
interchangeable: if Claude Code is unavailable, or if Codex reviews better than it writes, only
a binding changes — never the pipeline. That bet only holds if the contract between the
orchestrator and an agent is written down and machine-checked: which artifacts a role may read,
which it may write, whether it may touch product code, and how it reports back. Free-form
agent output would put the orchestrator in the business of parsing prose. This is Phase 0 of
`docs/plan.md`; the runners that execute against these contracts arrive in Phase 1.

## What Changes

- A role catalog naming the seven pipeline roles plus the Retro role, and for each: the
  artifact kinds it reads, the artifact kinds it may write, whether it may modify product code,
  whether it receives the house spec-standard skill, and its default provider.
- `RESULT.json` — the single structured channel out of an agent run, with a versioned schema, a
  parser that reports why a result was rejected, and defaults for optional fields.
- The `AgentProvider` interface every provider adapter implements: run a stage job, report auth
  health.
- The task state machine as data: the states, the legal transitions, the three human gates, and
  the loop caps that bound the research↔review cycle.
- A cross-provider review rule: the reviewer of an artifact must not be the provider that wrote
  it, degrading to same-provider review only when no alternative is configured.

## Capabilities

### New Capabilities
- `agent-contracts`: the role/provider boundary — what a role is allowed to do, what it must
  return, and how the orchestrator decides who reviews whom.
- `task-lifecycle`: the states a task moves through, which transitions are legal, where the
  human gates sit, and what bounds the review loops.

### Modified Capabilities
<!-- None: no existing capability changes behaviour. -->

## Impact

- New: `packages/core` — role catalog, provider interface, result schema, state machine.
- The database enums for role, provider, verdict, and task status are generated from the same
  vocabulary, so a role added in code and not in the schema fails to compile.
- Every later phase depends on these types; changing them is a breaking change to be proposed,
  not an edit.

## Non-goals

- No provider adapters. No CLI is invoked, no container is built (Phases 1 and 4).
- No prompt files. `roles/*.md` are named by the contract but authored in Phase 1.
- No planner or DAG generation — the run graph shape is stored, not produced (Phase 1).
- No enforcement mechanism yet: the contracts declare what a role may touch; the runner that
  rejects out-of-contract writes is Phase 1.
