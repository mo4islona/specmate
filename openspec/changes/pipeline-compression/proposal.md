## Why

Roadmap phase: the tail of Phase 3 — the economics §16.2 and §16.3 surfaced while pass 3 was
drawn, and which pass 3 deliberately did not fix.

The feature/bugfix pipeline walks twelve nodes, and four of them exist because the work was cut
along role boundaries rather than along what the work actually is. `kickoff_brief` is the planner
running a second time over the page it just wrote, forbidden by its own prompt from re-reading the
repository. `research` reads the whole repository again, from scratch, to write specs for a
proposal the planner already grounded — and may ground differently, so the spec can drift from the
brief the owner approved. `verify` and `code_review` both read the same diff, both loop back to
`implement`, and both count against the same cap.

Two defects sit underneath that shape. The declared size selects a profile and nothing else, so
`medium` and `large` produce byte-identical pipelines and a small task keeps a large task's
iteration caps. And `verify` binds `role_default`, whose default provider is the implementer's
own — so by default the agent that writes the code and the agent that writes the harness proving
it works come from the same provider. Only the reviewer, which executes nothing, is bound across
providers. The independence is on the stage that asserts and missing from the stage that proves.

## What Changes

- **`planning` and `kickoff_brief` become one `plan` node.** The second run reads its own draft
  and does not re-read the repository, so the split buys prose quality and costs a full stage
  dispatch. One node, one run, a two-phase instruction inside it. `checkBrief` stays the gate on
  quality and will report a regression immediately.

- **`research` stops being a separate role and becomes `specify`, a node that resumes `plan`'s
  provider session after the kickoff gate.** The repository is read once, by one agent, which then
  writes the specs from its own grounding. This removes the drift between the approved brief and
  the spec written against a second, independent reading. **BREAKING** for the `researcher` role,
  which no longer has a node scheduling it.

  A new `resumes` field on a stage node declares this. The provider's session store already lives
  on a persistent named volume mounted as the container's `HOME`, so a session outlives the
  container that started it; the session id becomes durable state on the stage row, which is what
  keeps this compatible with recovery after an orchestrator restart. No process is held open
  across the gate.

- **`verify` and `code_review` become one `validate` node**, bound `cross_review`. One agent
  writes the harness and returns the verdict, and because it may write code it can demonstrate a
  finding with a failing test rather than assert it in prose. **BREAKING** for the `verifier` and
  `reviewer` roles, which merge.

- **`verify`'s provider independence is fixed by construction.** `validate` is `cross_review`, so
  the agent that checks an implementation is never the one that wrote it. This closes a live
  defect, not only a shape.

- **`spec_review` becomes conditional on the spec it would review**, measured in scenarios rather
  than bytes. The predicate reads a fact about the node's input, never the verdict of the stage it
  would skip — a predicate resting on `validate`'s own verdict would be circular, and is
  explicitly out of scope (see Non-goals).

- **A skipped node stays in the graph and states why it was skipped**, in the slot a duration
  would occupy. Dropping a node from the graph hides the decision; skipping it with a reason shows
  it, and the rail already renders a node whose duration slot carries a reason.

- **`medium` gets a profile distinct from `large`, and the declared size scales caps**, so three
  declared sizes mean three different things rather than two on one axis and none on the other.

## Capabilities

### New Capabilities

None. Every behavior here is a change to a capability that already exists.

### Modified Capabilities

- `pipeline-definitions`: REQ-405's node set changes; REQ-407 gains the conditional node and the
  rule that a skipped node is still a node; REQ-408 makes the declared size select caps as well as
  a profile, and gives `medium` its own reduction.
- `agent-contracts`: REQ-101 and REQ-102 lose `researcher`, `verifier` and `reviewer` as
  separately scheduled roles and gain the merged validating role's contract; REQ-106's
  cross-provider rule extends to the stage that executes a harness, not only the one that judges.
- `agent-execution`: a stage may resume an earlier stage's provider session, which REQ-207 and
  REQ-209 currently phrase as though every attempt starts cold.
- `task-lifecycle`: REQ-602's happy path renames its nodes; REQ-606's caps become size-dependent.
- `kickoff-brief`: REQ-1301, REQ-1302 and REQ-1303 describe two planner runs where there is now
  one; REQ-1306's declaration point stays `plan`.
- `verification`: REQ-1101 and REQ-1103 describe a role that only verifies, where the merged role
  also judges — corroboration narrows to the claims about execution rather than the whole verdict.

## Non-goals

- **A predicate that skips `validate`.** Its only available input is `validate`'s own verdict,
  which is the claim `validate` exists to produce. Deferred with the reasoning recorded, not left
  open.
- **Collapsing the human gates.** Nothing here removes a gate or makes one auto-pass. A gate that
  passes itself when the machine had no findings is a real change to what a gate means and
  deserves its own decision.
- **Per-node model binding.** The merges dissolve the case for it: after them, every role appears
  at exactly one node, so binding per role and binding per node select the same thing. The
  per-role defaults of §16.2 remain their own change.
- **Warm continuation as an optimization.** `specify` resumes a session because that is how it
  gets the grounding, not to be fast. Holding sessions warm to shorten latency elsewhere is a
  separate question.
- **Grounding as an artifact.** Recording what the planner read, so a cold stage can consume it,
  stops being urgent once one session writes both artifacts. It returns if session resumption
  proves unreliable.
- **Retiring roles nothing schedules.** After this change `researcher` joins `spec_writer` and
  `retro` in the catalog with no node running it. Deciding what those roles are for — §16.3 asks
  it already — would remove stages rather than bound them, and belongs to that question rather
  than to this one.

## Impact

- `packages/core`: `pipeline.ts` (node set, profiles, the conditional node, caps by size),
  `roles.ts` (merged role, dropped roles, provider defaults), `state.ts` (caps), `brief.ts`.
- `packages/db`: a status-enum migration for the renamed node keys, and the stage row's session
  id.
- `packages/runner`: the provider session id is not parsed from the output stream today; `--resume`
  is not passed on any invocation.
- `apps/orchestrator`: `engine.ts` (dispatching a resuming stage, evaluating a node's predicate),
  `store.ts` (profile selection).
- `apps/web`: the rail renders a skipped node and its reason.
- `roles/`: `planner.md` absorbs the brief and the spec instructions; `verifier.md` and
  `reviewer.md` merge into one prompt; `researcher.md` stays in the tree with nothing scheduling
  it.
- In-flight tasks are unaffected: a task's graph is pinned, so a task already walking the old node
  set finishes on it.
