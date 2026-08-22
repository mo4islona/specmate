# Autonomy gaps — where the pipeline creates work and where it stops for the owner

This is a working note, not a change. It records a class of defect found while watching real
runs: the pipeline creates work for itself and hands questions to the owner in places where it
has enough information to act, and it forgets every answer the moment a task ends. The harness
split is the sharpest instance, but it is an instance, not the whole thing.

Part of this first landed as a prompt: the planner's question policy (`roles/planner.md`,
`9cadcd6`) states when a question is worth asking, caps how many, and requires options. A prompt
is the weakest place to enforce anything, so the rest went into the engine and the specs — two
changes, both drafted and implemented:

- `openspec/changes/planner-decomposition` — §2, §6 and §7. Planning declares the shape of the
  work; the engine bounds it.
- `openspec/changes/decision-floors` — §3 and §4. A floor under question volume, and an accepted
  coverage gap that outlives the task that accepted it.

Each section below keeps the analysis that motivated the change and ends with what closed it.

## 1. The shape of the problem

Four properties were missing, and every symptom below is one of them:

- **No cap on the work the pipeline creates for itself.** Loops, retries, redirects and budgets
  all have caps. Task creation does not.
- **No memory across tasks.** Every answer the owner gives is scoped to the task that asked.
  The next task against the same repository asks again, from zero.
- **No stated line between what an agent decides and what the owner decides.** Roles are told
  what they may write, never what they may settle. The default therefore drifts toward asking.
- **No one decides how much process a task needs.** The pipeline is a fixed walk, the same
  twelve nodes for a one-line fix and a subsystem rewrite, and no role is asked to size it.

## 2. Harness split recursion

Choosing "Build the harness first" creates a task (`Engine.splitHarnessTask`,
`apps/orchestrator/src/engine.ts`) and blocks the original on it. Nothing marks that new task as
being the harness. It runs the same pipeline, planning classifies the same area, coverage comes
back short of adequate again — correctly, because the harness does not exist yet — and
`recordHarnessCoverage` (`apps/orchestrator/src/store.ts`) offers the same three options,
including split. A live run produced a three-deep chain, each task blocked on the next.

Two things follow that are easy to miss:

- Prompting cannot fix it. The planner cannot create a task; it returns a classification. The
  chain comes from a deterministic branch in the engine, and the honest classification is the one
  that feeds it.
- The exit is not obvious either. On release the dependent re-enters at its pipeline entry and
  re-probes (REQ-1404, AC-1412), so the same offer can reappear after the harness lands.

Also worth deciding here: the split passes only slug, title, description, type, repo and branch
to `createTask`. Caps, budgets and model bindings resolve from settings, so every link in a chain
gets its own fresh budget and nothing bounds the chain as a whole.

Touches REQ-1401 through REQ-1404 in `openspec/specs/harness-coverage/spec.md`.

**Closed by `planner-decomposition`.** The split creates what the planner proposed rather than
what the engine wrote, and the recursion is closed by arithmetic, not by prose: a task records
its `plan_depth`, `max_plan_depth` defaults to 1, and the option list at the gate is computed
from that depth — a task at the cap is never offered a split, and the prompt says why. The chain
is traceable through `origin_task_id`. A chain-wide budget is still absent, and is now at least
computable; the change names it as a non-goal.

## 3. Decisions do not outlive the task that asked

`harnessStatus` and its waiver are columns on `tasks`. A repository the owner has already
accepted as under-covered has no way to say so to the next task, so the same gap, with the same
evidence, is raised again on every launch.

Open questions before this can be specified:

- What is the memory keyed on — repository, repository and area, repository and task type?
- What ends it? A later classification of the same area is the obvious candidate; wall-clock
  expiry is the obvious trap.
- How does the owner see that a task inherited an answer rather than being asked, and how do they
  take it back?

**Closed by `decision-floors`.** Keyed on the repository — the area lives in the probe's prose,
and durable state keyed on prose is keyed on nothing checkable. It ends when a probe classifies
that repository adequate, or when the owner revokes it in Settings; there is no wall-clock
expiry. The inheritance is written as an already-resolved decision naming the task the
acceptance came from, so it reaches the decision log every later stage reads and the task view,
without ever appearing as something the owner must act on.

## 4. Questions have a policy but no floor

The policy lives entirely in `roles/planner.md`. The engine accepts however many
`decisions_needed` entries a stage returns, and matches an existing open decision by node and key
(REQ-1202), so one question asked at two nodes is two cards — which is exactly what happened
before the prompt change moved questions to `kickoff_brief` alone.

To decide: whether the engine caps non-blocking questions per stage, and whether question
identity should be `(task, key)` rather than `(node, key)`. The second is a spec change, not a
bug fix — REQ-1202 says node and key deliberately.

**Closed by `decision-floors`.** Both, and REQ-1202 was modified rather than worked around: a
non-blocking question is identified by the task and its key, an escalation still by its node,
because two nodes escalating are two situations with two pieces of evidence. The cap
(`max_questions_per_stage`, default 3) exempts blocking requests — each one is why a task parked
— and what it refuses is named in the timeline.

## 5. Everywhere the pipeline stops for a human

Inventory, so the next change reasons about the whole surface rather than one card:

| Stop | Raised by | Bounded by |
|---|---|---|
| Three human gates | pipeline definition | by design |
| Reviewer escalation, cap exhaustion, repeated finding | `advance()` | loop caps |
| Budget exhaustion | engine | raise-or-cancel |
| Lost blocker | engine | one per dead blocker |
| Coverage gap | probing stage | **nothing** |
| Agent questions | any role's `decisions_needed` | **nothing** |

The bounded rows are fine. The two unbounded ones are this note. Both are bounded now: the
coverage gap by plan depth and prerequisite count, and by an acceptance that outlives its task;
the questions by a per-stage cap and an identity that stops multiplying one question by the
number of nodes that ask it.

## 6. The stage list is long, and stages overlap

`FEATURE_BUGFIX_PIPELINE` (`packages/core/src/pipeline.ts`) is twelve nodes, eight of them agent
stages, and every task walks all of them. Part of that list is one job cut in two:

- `planning` and `kickoff_brief` are both the planner, both write `proposal.md`, and both have
  that file checked for the same required parts afterwards. Only `Current state` in the ledger
  tells the prompt which half it is running.
- `research` then writes `proposal.md` a third time, on top of `design.md` and `specs/`.
- `spec_review` and `code_review` are the same role, the same prompt and the same contract at two
  points in the walk.
- `spec_writer` and `retro` sit in `ROLE_CONTRACTS` with no node scheduling them at all — the
  researcher writes the specs, the implementer writes `tasks.md`.

Repetition is not automatically waste: `planning` reads the repository and `kickoff_brief`
deliberately does not, and the two review nodes look at different artifacts. But the split is
asserted by a prompt, not by the graph — nothing stops `kickoff_brief` re-reading the repository,
and nothing distinguishes the two reviewer nodes except where they sit. A stage that costs a
provider call and a round of owner attention should be there because this task needs it.

Nothing sizes the walk either. The brief ends with `## Size` — small, medium or large, with the
iterations that size expects — and no code reads it; `size` appears nowhere in the engine. The
planner states how big the work is, and the graph is identical either way, because it is pinned
at creation from a per-type catalog (`instantiateDefinition`) and per-task variation is limited
to caps, budgets and provider bindings.

**Closed by `planner-decomposition`**, in part. The declared size now selects a pipeline profile:
a validated subsequence of the base definition, appended as a new run-graph version the moment
the size is known. `small` drops `kickoff_brief` and `spec_review` and keeps the spine, all three
gates, and the review of the code that ships. The overlap that remains — the researcher writing
the specs a scheduled `spec_writer` would write, `retro` in the catalog with no node — is
untouched and named as a non-goal: it is a question about what the roles are for, not about how
much process a task gets.

## 7. Decomposition belongs to the planner

The harness split is the only place the system decides to turn work into more work, and it is a
switch on an option id (`applyCoverageChoice`) firing after the brief is already written. The
planner is the one role that reads the repository before a plan exists. It is the role that could
say "this is three tasks, in this order" or "this is one task and the harness is half a day of
it" — and today it has no way to say either. It returns a classification; the engine turns that
into a task.

Put the decomposition in the plan and the recursion in §2 stops being possible: a harness task is
then a task the planner proposed, inside a plan that already knows the harness is being built,
rather than a copy of the parent arriving at the same three-way offer with the same honest
classification. §2 and this section are the same defect seen from both ends — the engine decides
how work is broken up, and the only role holding the evidence for that decision is not asked.

Open questions before this can be specified:

- What does the planner return? A list of tasks with dependencies, a split/don't-split flag with
  a reason, or a size the engine maps onto a shape?
- What bounds it — this is §1's missing cap, now with a second caller: tasks per plan, and depth
  per chain.
- May the walk itself vary with declared size — small skips stages, large keeps all of them — or
  does size only ever move caps and budgets?
- What happens to the engine's three-way coverage offer once the planner decides this? It becomes
  a fallback for a rejected plan, or it goes away.

**Closed by `planner-decomposition`.** The planner returns `plan: { size, prerequisites }` — a
flat, unordered list one level deep, which cannot recurse by construction. It is a proposal, not
an action: the owner still chooses at the kickoff gate, so a bad plan costs a click rather than a
chain of runs. The engine's offer stayed, generalized — it is raised for a coverage gap, for a
proposed plan, or for both — and the harness task it used to invent survives only as the fallback
for a gap the plan said nothing about.

## 8. Status

Both changes are implemented and their specs validate; neither is archived, so the deltas are
still readable next to the code that satisfies them. What this note started as — a class of
defect — is now two changes and one remaining question worth watching in a real run: whether a
planner asked to size its own work sizes it honestly. The two human gates before code are what
catch it if not.

Left deliberately open, each named as a non-goal in the change that touched it:

- No chain-wide budget. Every task in a chain still resolves its own from settings.
- No cap or budget scaling by declared size — the size selects the profile and nothing else.
- No ordering or dependencies among a plan's prerequisites.
- The role catalog's unscheduled roles (`spec_writer`, `retro`) and the researcher's double duty.
