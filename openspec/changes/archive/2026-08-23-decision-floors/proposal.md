## Why

`docs/autonomy-gaps.md` §3 and §4 — the two unbounded rows of the note's own inventory of every
place the pipeline stops for a human:

| Stop | Raised by | Bounded by |
|---|---|---|
| Coverage gap | probing stage | **nothing** |
| Agent questions | any role's `decisions_needed` | **nothing** |

The coverage gap is now bounded in *width and depth* by `planner-decomposition` — what it can
create is capped. It is still unbounded in *time*: `harnessStatus` and its waiver are columns on
`tasks`, so a repository the owner accepted as under-covered last week is raised again, with the
same evidence, on the next launch. The system forgets every answer the moment a task ends.

Agent questions are bounded by nothing at all. The engine accepts however many `decisions_needed`
entries a stage returns, and matches an open decision by `(node, key)` — so one question asked at
two nodes is two cards, which is exactly what happened before `roles/planner.md` was told to ask
only at `kickoff_brief`. That policy lives entirely in a prompt, and a prompt is the weakest place
to enforce anything.

## What Changes

- **A stage may raise only so many questions.** A new cap, `max_questions_per_stage` (default 3),
  bounds the non-blocking questions one stage result may turn into cards. Blocking requests are
  never dropped — they are the reason the task parked. What the cap left out is named in the
  task's timeline with its keys, never dropped in silence.
- **A question is identified by the task and its key, not by the node that asked.** A non-blocking
  question matching an open decision's key on the same task attaches to it, whichever node asked.
  Escalations and blocking requests keep `(node, key)`: an escalation is about a node, and two
  nodes escalating are two different situations.
- **An accepted coverage gap outlives the task that accepted it.** Proceeding past a coverage gap
  records the acceptance against the repository, not only the task. A later task against that
  repository inherits it: its coverage is waived without asking, and the inheritance is recorded
  as an already-resolved decision naming the task the acceptance came from, so it is visible in
  the log every later stage reads. It ends when a probe classifies that repository's coverage as
  adequate — the gap is gone, so the acceptance of it is spent — or when the owner revokes it from
  the Settings screen. There is no wall-clock expiry: an acceptance that is still true does not
  become false at midnight.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `decisions`: a floor under how many questions one stage may raise, and question identity that no
  longer multiplies one question by the number of nodes that ask it.
- `harness-coverage`: the waiver becomes a repository-scoped record a later task inherits, with
  the inheritance visible and reversible.
- `persistence`: the accepted coverage gap becomes a durable, revocable record scoped to a repository rather than a task.
- `task-surface`: repositories become readable over REST, each carrying the waiver in force for it, revocable in place.
- `operator-ui`: the Settings screen lists them and can revoke one.

## Impact

- `packages/core/src/state.ts`: `max_questions_per_stage` in `Caps`.
- `packages/core/src/decisions.ts`: the identity rule the store matches on.
- `packages/db/src/schema.ts` + migration: a `coverage_waivers` table — the repositories whose
  harness gap the owner has accepted; at most one in force each.
- `apps/orchestrator/src/store.ts`: the question cap and its event; the waiver read in
  `recordPlanOutcome`, the write when one is accepted, and the revocation an adequate
  classification performs.
- `apps/api/src/app.ts`: a repositories collection carrying each repository's waiver, and the
  revocation as a sub-resource of the repository it applies to.
- `apps/web`: a Settings section listing accepted coverage waivers, with a revoke control.

## Non-goals

- **No area-scoped memory.** The acceptance is keyed on the repository, not on the repository and
  the area the probe judged. The area lives in the probe's prose evidence, and keying durable
  state on prose is keying it on nothing checkable. A later adequate classification anywhere in
  the repository ends the acceptance, which errs toward asking again.
- **No memory of any other answer.** Only the coverage waiver becomes repository-scoped, and the
  table holds exactly that — no `key`/`value` pair standing in for durable answers that do not
  exist. Whether a brief's open questions should carry across tasks is a real question with no
  evidence behind it yet; when a second durable answer earns its place it will have its own
  fields, and can have its own table.
- **No expiry.** Neither wall-clock nor task-count. An acceptance ends when the world it described
  changes or when the owner ends it, and nothing else.
- **No cap on blocking decisions.** A stage that raises three blocking questions has parked the
  task three times over, which is a prompt problem, not a floor the engine can enforce without
  discarding the reason a task is parked.
