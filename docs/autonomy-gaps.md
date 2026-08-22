# Autonomy gaps — where the pipeline creates work and where it stops for the owner

This is a working note, not a change. It records a class of defect found while watching real
runs: the pipeline creates work for itself and hands questions to the owner in places where it
has enough information to act, and it forgets every answer the moment a task ends. The harness
split is the sharpest instance, but it is an instance, not the whole thing.

Part of this already landed: the planner's question policy (`roles/planner.md`, `9cadcd6`) now
states when a question is worth asking, caps how many, and requires options. That is a prompt,
and a prompt is the weakest place to enforce anything. Everything below needs the engine, and
most of it needs the specs.

## 1. The shape of the problem

Three properties are missing, and every symptom below is one of them:

- **No cap on the work the pipeline creates for itself.** Loops, retries, redirects and budgets
  all have caps. Task creation does not.
- **No memory across tasks.** Every answer the owner gives is scoped to the task that asked.
  The next task against the same repository asks again, from zero.
- **No stated line between what an agent decides and what the owner decides.** Roles are told
  what they may write, never what they may settle. The default therefore drifts toward asking.

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

## 4. Questions have a policy but no floor

The policy lives entirely in `roles/planner.md`. The engine accepts however many
`decisions_needed` entries a stage returns, and matches an existing open decision by node and key
(REQ-1202), so one question asked at two nodes is two cards — which is exactly what happened
before the prompt change moved questions to `kickoff_brief` alone.

To decide: whether the engine caps non-blocking questions per stage, and whether question
identity should be `(task, key)` rather than `(node, key)`. The second is a spec change, not a
bug fix — REQ-1202 says node and key deliberately.

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

The bounded rows are fine. The two unbounded ones are this note.

## 6. Status

Draft. The next step is an OpenSpec change against `harness-coverage`, and possibly `decisions`,
once the questions in §3 and §4 have answers.
