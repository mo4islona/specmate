## Context

See `proposal.md` — Why. The role table and the state diagram come from `docs/plan.md` §4 and
§5. This document records how they are represented in code and which details the plan left open.

## Goals / Non-Goals

**Goals:**
- One vocabulary shared by the database, the orchestrator, and the runners.
- A result contract strict enough that a stage either produced something machine-usable or
  visibly failed — never "probably fine".
- A state machine that can be tested without running an agent.

**Non-Goals:**
- Executing anything. No CLI is spawned in this change.
- Authoring the role prompts. The contract names `roles/*.md`; the prose is Phase 1's problem.
- Runtime enforcement of the read/write declarations — declaring them is what makes enforcement
  possible later.

## Decisions

**Contracts are data, not classes.** The role catalog is a plain record keyed by role, and the
state machine is a transition map. Both are directly testable and directly renderable in the UI,
and neither invites per-role special cases to accumulate as method overrides.

**Zod schemas own the wire formats; TypeScript types are derived.** `RESULT.json` crosses a
process boundary from an agent that may hallucinate its shape, so it needs a runtime check;
deriving the static type from the same schema keeps the two from drifting. The parser returns a
result object rather than throwing, because "the agent wrote nonsense" is an expected outcome
that maps to a retry, not an exception path.

**`schema_version` is a literal, not a range.** Version 1 is the only accepted value. When the
contract changes, the accepted set changes in a reviewed migration of this spec — an agent
running an old prompt should fail loudly rather than have its output leniently coerced.

**Findings carry caller-stable identifiers.** Oscillation detection (§5 of the plan) compares
finding identity across rounds. Deriving identity by hashing the finding text would make a
reworded complaint look new, which is exactly the failure mode the cap exists to catch, so the
identifier is the reviewer's responsibility and is part of the contract.

**Decision requests carry a stable key per stage.** A retried stage will re-ask the same
question. Without a key the orchestrator either creates duplicate decisions or has to compare
prompt text; the key makes matching exact.

**`waiting_human`, `paused`, and `blocked` are states, not flags, but their return path is
stored on the task.** Modelling every interrupt as an edge from every active state would make
the transition table quadratic and unreadable. Instead the interrupt states have no outgoing
edges in the table, and the task records the state to resume into.

**`failed` is recoverable; `archived` and `cancelled` are not.** A crashed stage should be
restartable from an earlier point without inventing a new task. Completion and abandonment are
decisions, and reversing them should mean creating a new task with its own history.

**Cross-provider review degrades rather than skips.** With one provider configured, review by
the same provider is worse than cross-model review but far better than none. Silently skipping
review when configuration is thin would remove the pipeline's main safety property exactly when
the owner is least likely to notice.

## Risks / Trade-offs

- **Agents may ignore the declared read/write boundaries** → declarations here are the input to
  the Phase 1 runner check that compares the changed file set against the contract.
- **Reviewers may not produce stable finding identifiers** → the reviewer prompt must make this
  explicit; until then, oscillation detection can under-report, which fails safe toward looping
  rather than toward false escalation.
- **A single `schema_version` literal makes contract changes breaking** → intended; the version
  exists so that breakage is visible.
- **The transition table can drift from the diagram in `docs/plan.md`** → the table is the
  authority, and its tests encode the happy path explicitly so a divergence shows up as a
  failing test rather than as stale prose.

## Migration Plan

No prior contract exists. Changing these types after Phase 1 is a breaking change and must ship
as its own OpenSpec change.

## Open Questions

- Whether the Retro role belongs in the same catalog as the pipeline roles or in its own. It is
  included for now because it consumes and produces the same artifact kinds; separating it later
  would not change any pipeline behaviour.
