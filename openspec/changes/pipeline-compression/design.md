## Context

See proposal.md — Why. What matters here is the machinery the shape has to fit into.

`advance()` is pure and forbidden from branching on task type, role, or node identity beyond what
the graph declares. A task's graph is pinned at creation and re-pinned only when planning declares
a size, so a catalog changed by a deploy cannot reshape a task in flight. Node keys are values of
the task-status enum. A profile is validated as a subsequence of its base at module import, so a
broken catalog is a failed deploy rather than a stuck task.

One fact makes session resumption cheap rather than architectural: the runner mounts a persistent
named volume as the container's `HOME`, and the provider CLI keeps its session store there. A
session already outlives the container that opened it. What is missing is reading the session's
identifier out of the output stream and passing it back on a later run.

## Goals / Non-Goals

Goals beyond the proposal's: keep `advance()` pure; keep the status enum additive so tasks pinned
on the old shape finish on it; make a conditional node's circularity a load-time failure rather
than a review convention.

Non-goals beyond the proposal's: no change to how gates are answered, to budgets, or to the
ledger. No expression language for predicates.

## Decisions

### D1 — Reuse a status value where the meaning survives; add one where it does not

`planning` keeps its key: the merged node is still the planner grounding a brief. The
specification node and the validating node get new keys, `specify` and `validate`, because neither
`research` (a role that no longer runs it) nor `verify` (only half of what it now does) names the
node honestly, and a status the owner reads should not lie about what the task is doing.

`kickoff_brief`, `research`, `verify` and `code_review` leave the catalog and **stay in the enum
forever**. Tasks pinned on the old graph reference them, and the transition table is derived from
the pinned graph rather than from the catalog, so those tasks keep walking. The migration is
additive; nothing is dropped.

*Alternative considered*: reuse `verify` for the merged node and skip one enum value. Rejected —
the saving is one migration line, and the cost is a status that reads as "running the harness"
while the stage is also judging the diff.

### D2 — A predicate is a named entry in a registry, not an expression

A conditional node declares `{ predicate: <id>, threshold: <n> }`. The id resolves to a registry
entry holding a pure function over a fact bundle the engine assembles before evaluating, plus a
declaration of which facts it reads. `advance()` stays pure: facts in, decision out, no branching
on which node it is looking at.

The declaration of what a predicate reads is what makes REQ-409's circularity check mechanical.
Validation walks each conditional node, resolves its predicate, and fails the load if the facts it
declares include an output of the guarded node or of a node whose purpose is to check that node.
Without the declaration the rule would be a convention nobody enforces.

*Alternative considered*: a small expression language over facts. Rejected — it buys flexibility
nobody has asked for and makes the circularity check a parser problem.

The one shipped predicate is `spec_scenarios_below`, counting scenarios declared in the change's
`specs/`. Scenarios rather than bytes: what a spec review can catch scales with how many separate
assertions the spec makes, not with how long its prose is.

### D3 — Resumption forks the base session rather than continuing it in place

`specify` declares that it resumes `planning`. The runner captures the provider session identifier
from the output stream and stores it on the stage row; the resuming dispatch passes it back.

The resumption **forks**: it starts from the base session's state and writes into a new session,
leaving the base untouched. This is what makes REQ-209 hold. A retry of `specify` after a failed
attempt must not read the failed attempt's own reasoning, and if resumption appended to the base
session in place, the second attempt would inherit exactly that. Forking makes a retry
re-derivable: every attempt starts from `planning`'s session as `planning` left it.

Where the provider cannot fork, or the session is gone, the stage runs cold from artifacts and
ledger and records that it did. The artifacts are the contract; the session is grounding.

*Alternative considered*: hold the container and the process open across the gate. Rejected — a
gate is an unbounded wait, it would burn the task's wall-clock budget, and an orchestrator restart
would kill every task parked on one. The property wanted is continuity of context, and a durable
identifier delivers it without a live process.

### D4 — Sizes differ on two axes, and only one profile is a reduction

| | profile | `max_spec_iterations` | `max_impl_iterations` |
|---|---|---|---|
| `small` | `compact` — drops `spec_review` | 1 | 2 |
| `medium` | `full` | 2 | 3 |
| `large` | `full` | 3 | 4 |

`small` never evaluates the predicate because its profile has no node to evaluate; `medium` and
`large` carry `spec_review` and skip it when the spec is small. `medium` and `large` share a
profile and differ in caps, which is what REQ-408 requires: no two sizes may select the same
profile *under the same caps*.

*Alternative considered*: three profiles, with `medium` dropping something `large` keeps. Rejected
— after the merges the only droppable node left is `spec_review`, and the spine (REQ-602) holds
everything else. Inventing a third profile would mean inventing a node to drop.

### D5 — The merged validating role keeps two lenses in one prompt

The prompt states them as separate obligations: execute the harness against the spec, then read
the diff against the spec. It names "my harness passed" as insufficient ground for approve — the
trap the merge creates is an agent evaluating code through the tests it just wrote, and the only
place to close it is the prompt.

Corroboration narrows from the verdict to the report's execution claims (REQ-1103). A `revise`
returned over a fully passing harness must stand, because that is the judgement the merge exists
to preserve.

## Risks / Trade-offs

- **No second agent audits the harness's assertion strength** → The merged role is not the code's
  author, so it has no stake in the code passing; the prompt makes "the harness passed" explicitly
  insufficient; and a weak spec or weak harness still surfaces at the final gate. Accepted as the
  cost of the merge, named rather than hidden.
- **The provider may not support forking a session** → AC-235's cold fallback covers it: the stage
  runs from artifacts and records why. Verify against the pinned CLI before building D3; if
  forking is unavailable, resumption ships read-only-from-base or not at all, and the change still
  delivers every other item.
- **One planner run produces a worse brief than two** → `checkBrief` is textual and dumb and runs
  on every planner run, so a regression shows as failed attempts naming missing parts rather than
  as quiet quality drift. If it shows, the two-phase instruction inside the single run is the knob.
- **A spec written by the planner rather than a spec-skilled researcher** → the merged planner run
  receives the house spec-standard skill (REQ-101, AC-103). At `small` no automated check reads the
  spec at all, which is why `validate` stays unconditional at every size.
- **Two live tasks straddle the deploy** → nothing to mitigate: pinned graphs mean an in-flight
  task finishes on the node set it started with. Only tasks created after the deploy see the new
  shape.

## Migration Plan

1. Additive status-enum migration for `specify` and `validate`; the stage row gains its session
   identifier. Nothing is dropped, so the migration is reversible by leaving the new values unused.
2. Ship the catalog change. New tasks pin the new definition; in-flight tasks keep theirs.
3. Rollback is a redeploy of the previous catalog. Tasks pinned on the new definition would then
   reference `specify`/`validate` against a catalog that no longer defines them, so rollback is
   safe only while no task has been created on the new shape — after that, roll forward.

## Open Questions

- Which threshold `spec_scenarios_below` should carry. It is one number in the catalog, changeable
  without touching a spec, an interface, or the task breakdown, and the honest way to pick it is
  from a handful of real specs rather than from a guess made now.
