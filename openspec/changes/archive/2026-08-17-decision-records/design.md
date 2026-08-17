## Context

See proposal.md — Why. What already exists, and the seams this change has to fit:

- `advance()` in `packages/core` returns a park with one of four causes — `needs_decision`,
  `escalate`, `cap_exhausted`, `repeated_finding` — and the engine turns that into
  `waiting_human` plus a `task.parked` event carrying the cause in its payload. The park is
  already correct; nothing durable comes out of it.
- The `decisions` table has held `key`, `kind`, `prompt_md`, `options`, `answer_md`,
  `answered_by`, `status`, and an index on open rows since the Phase-0 data model. It has a
  `stage_id`, which points at one *attempt*, not at a graph node.
- `RESULT.json` already carries `decisions_needed[]` with a `blocking` flag (REQ-105), and a
  `needs_decision` result commits its partial work: the executor withholds the commit only
  from a `failed` result. So a stage that asks leaves its half-finished artifacts on the
  branch, which is what makes resuming the same node from committed state meaningful.
- `decision_log` is an artifact kind, `decisions.md` maps to it, and researcher, spec writer,
  implementer, reviewer, and summarizer all declare it among the kinds they *read*. **No role
  declares it writable.** Prompt assembly injects exactly the kinds a role reads, so a
  `decisions.md` in the change folder reaches every one of those prompts with no new plumbing.
- `feedback` already has a `decision_answer` kind, unused.
- `task-qa` now defines durable task conversations, subject scoping, contextual guide runs,
  and owner-confirmed actions. A process may create a subject conversation without starting a
  model run, and an answer proposal remains inert until confirmed.
- The API constructs an `Engine` whose workspace adapter refuses to provision — "the API never
  provisions workspaces" is wired in as an error, not a convention — and reaches it through a
  narrow `GateOperations = Pick<Engine, 'approve' | 'redirect' | 'rework'>`.
- The write-scope check distinguishes only the change folder from product code, so nothing
  mechanically stops an agent from editing `decisions.md`.

## Goals / Non-Goals

**Goals:**

- One invariant carries the feature: parked ⇔ something open to resolve. Every park cause
  routes through the same record, so the inbox, the card, and the resume path are written once
  rather than per cause.
- The store is the source of truth for what was asked and answered; the change folder gets a
  rendering. That keeps the control plane free of a working tree and makes the answers
  survivable across a discarded workspace.
- No new transition semantics. Resolving a decision drives the *existing* resume; the engine
  keeps its "no branching on role, type, or node identity" discipline.
- Discussion is available before commitment without weakening the decision record: transcript is
  explanatory context, while one explicit operation remains the source of the outcome.

**Non-Goals:**

- Deciding *which* questions are worth asking. Prompt quality is the role prompts' business
  and, later, the Retro agent's.
- Any coupling between decisions and gates. A gate is a scheduled approval on the pinned
  graph; a decision is an unscheduled question. They stay separate mechanisms even though both
  end up in the same inbox.

## Decisions

### IDs stay within capability bands

Per the `openspec-standard` skill this repo ships: the new `decisions` capability claims band
1200 (REQ-1201–REQ-1207, AC-1201–AC-1224) in `openspec/id-bands.yaml`; the modified
requirements keep their IDs (REQ-105, REQ-307, REQ-1009) and their new scenarios take the next
free numbers in their own capability's band — AC-128 in agent-contracts,
AC-324/AC-325/AC-332 in persistence, AC-1022–AC-1025/AC-1031 in task-surface, and
AC-921–AC-924/AC-933/AC-934 in operator-ui. IDs are immutable and never reused.

### Identity is (node, key), unique only while open

A decision's identity cannot be the stage row: a retried attempt is a different row asking the
same question, which is exactly the duplicate AC-113 forbids. It also cannot be the key alone:
keys are only promised to be stable within the asking role's own scope, so two nodes may
collide. So `decisions` gains a `node_key` column, denormalized from the stage it was raised
at, and the uniqueness lands as a **partial unique index over open rows**
`(task_id, node_key, key) where status = 'open'`.

That index buys three behaviours in one line of DDL: a retry attaches instead of duplicating,
a re-ask after an answer opens a fresh record rather than clobbering the old one, and the
history under a key accumulates for the Retro agent. `stage_id` stays, pointing at the attempt
that raised it, because the feedback record needs that stage's role and provider.

### Every park raises a decision, including the engine's own

The alternative was to let agent-raised questions be records while engine-raised parks stayed
event payloads. Rejected: the inbox would have two item shapes, the card would have two
renderings, and "why is this stopped" would be answerable only by reading the log for three of
the four causes. Instead `advance()`'s `ParkCause` becomes the input to a pure renderer in
`packages/core` that turns a park plus its evidence — the round's verdict and findings, the
loop and cap, the repeated identifiers — into a decision to insert. The engine still does not
branch on node or role: it branches on the cause its own pure function already returned.

The escalation's key derives from the cause and the round (`escalate:spec:2`,
`cap:impl:3`, `repeat:<finding-id>:spec:2`), so a re-entered node parking for the same reason
in the same round attaches to the open record rather than raising a second one.

### Raising a decision also creates an inert discussion

The decision insert and one `decision`-scoped conversation insert share the park/request
transaction. This extends the invariant from "there is something to answer" to "there is one
place to understand it" without coupling task progress to a model: creating the conversation
does not enqueue a response, allocate a runtime, or spend tokens. The first owner message does.

Subject uniqueness from REQ-312 prevents two discussion threads for one decision. Re-attaching a
retry to an existing open decision also reuses its conversation; re-asking after resolution
creates a new decision and therefore a new discussion. The conversation receives the stored
decision prompt, options, engine evidence, task artifacts, and its own prior turns through the
normal contextual guide path. No private transcript from the stage that raised the decision is
required or available.

The transcript remains readable and may continue while the task is non-terminal after
resolution. That does not make the answer mutable. If later discussion reveals that the recorded
outcome was wrong, the owner uses a separately confirmed intervention or the pipeline raises a
new decision; history is appended rather than rewritten.

### The decision log is a projection, refreshed before the stage that reads it

The answer arrives at the API, which has no working tree by construction. Writing it into the
change folder from there would give the control plane a git dependency and a lock to contend
with the orchestrator over. So the answer lands in Postgres, and the orchestrator renders
`decisions.md` from the store into the change folder immediately before it dispatches a stage
— the one moment the content matters, in the one process that owns the tree. The rendering
rides that stage's own commit, so the log's history follows the branch like every other
artifact.

This is a deliberate exception to REQ-301 ("git holds artifacts, Postgres indexes them"), and
it is a narrow one: `decisions.md` is the only artifact no role may author. The store being
authoritative is what makes AC-1217 (an agent scribbles in the log) and AC-1218 (the workspace
is rebuilt) both come out right without any enforcement machinery.

### The parked attempt is recorded as waiting, not as succeeded

`stage_status` has carried a `waiting_human` value since Phase 0 and nothing has ever written
it. A stage that asked a blocking question did work and committed it, but it did not finish
its node — recording it as `succeeded` makes the stage history claim otherwise. The engine
writes `waiting_human` on that attempt instead. Nothing downstream reads stage status except
the in-flight check (`running`) and the attempt-cap streak (trailing `failed`), so parking
still does not consume the node's attempt budget — which is the behaviour that must not
change: a question is not a failure.

### Resolution is an engine operation the API borrows

`answer` and `dismiss` join `approve`, `redirect`, and `rework` on the `Engine`, under the same
per-task advisory lock and in one transaction, and the API's narrow `Pick<>` widens to include
them. That keeps REQ-1007's rule intact — the API implements no transition of its own — and it
means the admin CLI gets the same operations for free.

`Engine.resume` stays for `paused` (budget enforcement will need it) but stops being the way a
`waiting_human` task moves: REQ-1204 leaves a parked task exactly two exits, resolving its
blockers or cancellation. Rework is not one of them — it is a gate operation and a parked task
is not at a gate — so the owner who wants a parked task redirected answers or dismisses first,
and acts at the next gate. The admin entry's `resume` subcommand becomes `answer`/`dismiss`,
which is a better operator affordance anyway: it records *why* the task was allowed to
continue.

A direct option/free-text submission and confirmation of an `answer_decision` proposal both call
this same operation with the decision id and expected open status. Conversation messages cannot
call it implicitly. This keeps a drafted answer, a user saying "why?", or an assistant saying
"I recommend A" from becoming accidental consent. A stale proposal loses to a prior answer or
dismissal and returns the same conflict as any second resolution.

### Non-blocking questions are recorded, not parked

`DecisionRequest.blocking` exists in the contract and has never meant anything. It means this:
a non-blocking request is stored, listed, and shown as a card, and the task advances. It gives
a role a way to flag something worth the owner's attention without stopping the pipeline —
and, because it lands in the same log, the answer still reaches later stages.

## Risks / Trade-offs

- **The park invariant can be violated by a bug.** If the engine parks and the decision insert
  fails, the task is stuck with nothing to answer. Mitigation: the park transition and the
  decision insert commit in one transaction, the same way the round record and its transition
  already do; and the startup sweep treats a parked task with no open decision as a defect it
  reports rather than silently repairs.
- **Answered-then-re-asked can loop.** Nothing here caps how many times a node may re-ask the
  same key; a badly behaved role could ping-pong with the owner. The stage attempt cap does not
  apply, because a parked stage is not a failed one. Accepted for now: the history under one
  key makes the pattern visible, and the repeated-finding detector's equivalent for decisions
  is a Retro-agent observation before it is a mechanism.
- **The log grows without bound on a long task.** It is truncated by the same ledger byte
  limit machinery the runner already applies, oldest-resolved-first; the store keeps
  everything.
- **A dismissal is indistinguishable from an answer to a careless reader.** Hence the explicit
  requirement (REQ-1206) that it renders as a dismissal in the log and everywhere a decision is
  read — an agent must not read "dismissed" as permission to assume an answer.
- **The guide may confidently recommend the wrong option.** → its recommendation is visibly a
  proposal, the decision stays open, and confirmation repeats the exact option/text before the
  resolution operation runs.
- **The discussion can outlive the choice and appear to reopen it.** → resolved cards retain the
  immutable outcome; later messages are commentary and require a new explicit action to affect
  the task.

## Migration Plan

One decision migration: `node_key` and `blocking` columns on `decisions`, plus the partial unique
index over open rows. Discussion storage is supplied by the preceding `task-qa` migration; this
change writes one scoped conversation with each decision and adds no second conversation schema.

Ordering against the in-flight changes: `task-qa` archives first because REQ-1207 uses its
conversation scope and confirmation contracts. After that, the `agent-contracts` delta touches
REQ-105 while `verifier-stage` touches REQ-104, and the `persistence` delta touches REQ-307 while
the conversation change touches REQ-302/REQ-309/REQ-310/REQ-312. `verifier-stage` and this
change both make a stage's outcome mean more than "it ran", but they meet only at `advance()`'s
existing park causes, which neither changes.
