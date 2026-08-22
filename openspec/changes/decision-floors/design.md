## Context

Two of the note's symptoms share one shape: a rule that exists only in a prompt, or only for the
lifetime of one task.

`roles/planner.md` says how many questions are worth asking and where to ask them. The engine
does not know. `raiseDecision` records whatever arrives, and matches an open record by
`(nodeKey, key)` — so the same question from `planning` and from `kickoff_brief` is two cards.
The prompt fix (ask only at `kickoff_brief`) works exactly as long as every future prompt
remembers it.

`harnessStatus` is a column on `tasks`, and so is the `waived` value the owner's acceptance
writes. Nothing carries it further. The next task against the same repository probes the same
uncovered area, gets the same honest classification, and raises the same card.

## Goals / Non-Goals

**Goals**

- A floor under question volume that a prompt cannot lower.
- One question is one card, however many nodes ask it.
- An accepted coverage gap is accepted once per repository, not once per task.
- The inheritance is visible where the owner already looks, and reversible.

**Non-Goals**

- Area-scoped or expiring memory (see the proposal's non-goals).
- Making any other answer durable.

## Decisions

### The cap discards, and says what it discarded

Three non-blocking questions per stage result. Past that, the extra requests are not recorded, and
an event names their keys. Two alternatives were rejected:

- *Failing the stage attempt.* The work is done and committed by the time decisions are recorded;
  failing it there would throw away a good result over a formatting excess.
- *Recording them all and hiding the surplus in the UI.* The floor has to be where the record is
  made, or the cards exist and something else has to remember to ignore them.

The event is the point. A silently truncated question list reads as "the stage had few questions",
which is the class of defect this whole note is about.

### Blocking requests are never capped

A blocking request is the reason a task parks (REQ-1201: a parked task always has an open decision
behind it). Dropping one would leave a task parked with nothing open against it — the exact
invariant the decisions capability exists to protect. Only non-blocking questions are capped.

### Identity: `(task, key)` for questions, `(node, key)` for everything else

REQ-1202 deliberately said node-and-key, and AC-1207 asserted that two nodes asking one key are
two decisions. That is right for an escalation: `advance()` raises those from a node, and two
nodes escalating are two situations with two pieces of evidence.

It is wrong for a question. A question is about the work, not about where in the pipeline someone
happened to think of it. `planning` and `kickoff_brief` asking `auth-scope` is one question, and
the owner should answer it once.

So the match narrows by kind: a non-blocking `question` request attaches to an open decision with
the same key on the same task, whatever node raised it; everything else keeps the old rule. The
prompt of the attached record is refreshed exactly as it already is when a retry changes it, so
the second node's phrasing is not lost under the first's.

### A repository policy, not a repository column

The acceptance goes in its own table keyed by `(repo_url, key)` rather than on a `repositories`
table, because there is no such table: a repository is a URL on a task row. A table of policies
keyed by URL is the smallest thing that can hold a durable answer, and it generalises — `key`
names which answer, and today there is exactly one.

At most one live record per `(repo_url, key)`, enforced by a partial unique index on the
non-revoked rows. Revoking sets `revoked_at` rather than deleting: what the owner accepted, and
when they took it back, stays readable.

### Inheritance is a resolved decision, not a new kind of thing

When a task inherits, the engine writes the same `harness-coverage` decision it would have raised
— same node, same key — already answered, with the answer naming the task the acceptance came
from. Three things follow for free: it is in the decision log every later stage reads (REQ-1205),
it is in the task view's decision list, and it never appears in the attention inbox, because the
inbox shows open decisions. The owner sees that a question was settled without being asked to
settle it again.

The alternative — an open, non-blocking "you are inheriting this, click to disagree" card — was
rejected for being the same interruption the change exists to remove.

### Revocation lives in Settings

An inherited acceptance is durable, cross-task state, which is what the Settings screen is for. A
control on the task screen would put a repository-wide action inside one task's view, where
revoking it would silently change every other task against that repository.

Automatic revocation is narrower than it looks: only a probe classifying that repository's
coverage as `adequate` ends the acceptance. A `partial` or `missing` classification is the
situation the owner already accepted, and re-raising on it is precisely the loop being closed.

## Risks / Trade-offs

- **The repository is a coarse key.** An acceptance made for an uncovered ingestion path also
  covers an uncovered API path in the same repository. Mitigated by the automatic revocation
  erring the other way — any adequate classification anywhere in the repository ends it — and by
  a visible, revocable record. The alternative, keying on the probe's prose, is not checkable.
- **A stale acceptance is invisible until it matters.** A repository whose harness was fixed by
  hand keeps its acceptance until a probe says adequate. The cost is a waived task that did not
  need waiving, and the record says where the waiver came from.
- **The question cap can hide a real question.** Three is a judgement. The event names the keys
  that were dropped, so the loss is legible, and the cap is a per-task override like every other.

## Migration Plan

One additive migration: the `repo_policies` table and its partial unique index. Nothing to
backfill — an existing task's `harnessStatus = 'waived'` stays exactly what it was, a fact about
that task. It does not retroactively become a repository policy: the owner accepted it for that
task, under that task's evidence, and inventing a repository-wide acceptance out of it would be
the system deciding something the owner never said.

`max_questions_per_stage` joins `Caps` with a default, and the migration merges it into existing
rows' `caps` alongside the column-default change — the same treatment, for the same reason, as the
plan caps in `planner-decomposition`.
