## Why

Phase 2 of `docs/plan.md` opens with decisions, and the pieces around them are all in place
and all inert. The result contract lets an agent request a decision instead of guessing
(REQ-105); the engine already parks a task awaiting a human for four distinct causes — an
agent asked, a review escalated, a loop spent its cap, a finding repeated to its threshold;
the `decisions` table has held a key, a prompt, options, an answer, and a status since Phase 0.
Nothing writes a row. A parked task today explains itself only through the payload of one
event, resumes only through a programmatic call no client can make, and carries none of what
the human said into the next run's context.

That gap is the whole point of the phase. The plan's exit criterion is a deliberately
ambiguous task escalating instead of looping and an answer resuming it, all from the UI — and
the flywheel argument behind it (§12) is that the owner's answers are the training signal. The
owner also needs to understand a choice before committing to it: discussion belongs in a
conversation, while the selected outcome still has to be captured as a structured decision
record rather than inferred from chat prose.

This change makes a decision a first-class record: raised by an agent or by the engine,
durable, listable, answerable over the API, written back into the change folder where the
next stage reads it, and captured as feedback. Everything else in Phase 2 — open questions on
the kickoff brief, budget exhaustion, notifications — parks a task and needs something for the
human to answer; this is that something.

## What Changes

- **Every park is explained by an open decision.** An agent's blocking request becomes a
  decision; so does a park no agent asked for — an escalate verdict, an exhausted loop cap, a
  finding that repeated — raised by the orchestrator with the evidence rendered into it. The
  invariant runs both ways: parked implies an open decision, and resolving the last one
  resumes the task. "Why is this task stopped" stops being a question answered by reading the
  event log.
- **Identity is the stage node plus the key, and only while open.** A retried attempt asking
  the same question attaches to the same record; asking again after an answer opens a new one
  and leaves the old answer readable. The database enforces at most one open decision per
  node and key, so duplicates are impossible rather than merely avoided.
- **Answering is one atomic act**: the answer, the answering identity and time, a
  `decision_answer` feedback record, an event, and — when nothing blocking remains open — the
  task's return to the state it was interrupted in. The API delegates to the same orchestrator
  operation the admin entry uses; it implements no transition of its own.
- **Every decision is discussable before it is resolved.** Raising a decision creates one
  decision-scoped conversation without starting a model run. The owner may ask follow-ups, see
  a drafted answer, and keep the task parked until explicitly confirming that answer or using the
  direct answer/dismiss controls. Conversation messages never count as consent.
- **The decision log becomes a generated projection.** `decisions.md` is rendered from the
  stored decisions and refreshed into the change folder before each stage runs, so every
  prompt carries the answers in force and a re-provisioned workspace reproduces them. No role
  writes it — none ever declared it writable — and an edit an agent leaves in it is never read
  back as an answer.
- **Decisions surface where the owner already looks**: the attention aggregation gains them as
  a source, the task view renders them as accented cards with the offered options as direct
  actions, and answering from the card resumes the task without a reload.
- **Dismissal is a real outcome.** The owner may dismiss a question rather than answer it, and
  a task reaching a terminal state dismisses whatever it left open — an inbox that accumulates
  dead questions is an inbox nobody reads.

## Capabilities

### New Capabilities

- `decisions` (REQ-1201–REQ-1207): what a decision is and when one must exist — the park
  invariant, how requests become records and how they are matched, the escalations the engine
  raises itself, the discussion available before resolution, the atomic answer that resumes the
  task, the generated decision log, and how an open decision stops being open.

### Modified Capabilities

- `agent-contracts`: REQ-105's decision key is sharpened from "stable within its stage" to
  stable within the stage *node* across its attempts and rounds — which is what its own
  AC-113 (a retry re-asking maps to the existing decision) already requires, since a retry is
  a new stage row.
- `persistence`: REQ-307 gains the node the decision was raised at, whether it blocks, and the
  database-enforced rule that one node and key hold at most one open decision while resolved
  ones accumulate as history; each record has the unique discussion supplied by REQ-1207.
- `task-surface`: decisions become readable and answerable over REST (REQ-1011), and the
  attention aggregation (REQ-1009) gains open decisions as a source it may not omit.
- `operator-ui`: decision cards in the task timeline (REQ-912) — the visually accented surface
  the plan (§8) requires for anything needing the owner — gain contextual discussion and explicit
  answer confirmation.

## Impact

- `packages/db`: `decisions` gains the node key and a blocking flag, plus a partial unique
  index over open rows; the preceding `task-qa` change supplies decision-scoped conversations.
- `packages/core`: rendering a decision request and an engine-raised escalation into a stored
  decision, and rendering the stored set into the decision log — pure functions, testable
  without a database.
- `apps/orchestrator`: the engine raises decisions where it parks today, resolves them on
  answer or dismissal, and refreshes the log into the change folder before a stage runs; the
  parked stage attempt is recorded as awaiting the human rather than as a plain success. Raising
  also creates the inert discussion in the same transaction.
- `apps/api`: decision list, answer, and dismiss endpoints delegating to the engine, and the
  attention list widened; `apps/web`: the card in the timeline and the inbox item.
- Ordering: after `task-qa`, whose REQ-1601, REQ-1603, REQ-1606, and REQ-312 provide scoped
  conversations, reconstructable context, confirmed actions, and subject uniqueness. The
  `agent-contracts` delta touches REQ-105 rather than `task-qa`'s REQ-102; the `persistence`
  delta touches REQ-307 rather than its REQ-302/REQ-309/REQ-310/REQ-312, so archive application
  remains mechanical once that dependency is satisfied.

## Non-goals

- **No new park causes.** Budget exhaustion pauses a task and will raise a decision through
  exactly this mechanism, but budget enforcement is its own Phase-2 change; nothing here reads
  a budget.
- **No kickoff brief and no open questions on it.** The planner prompt does not exist yet; the
  brief's questions become decisions through this mechanism once that change ships.
- **No notifications.** A raised decision emits an event; pushing it to Slack, Telegram, or a
  phone is the notifications change. The Attention Inbox stays the pull-based surface.
- **No conversational resolution.** Discussion is supported, but no message, summary, or
  assistant proposal is interpreted as an answer. Resolution remains an explicit decision
  operation.
- **No automatic restart from discussion.** A decision conversation may separately propose a
  `task-qa` intervention, but that action requires its own confirmation and never substitutes
  for answering or dismissing the decision.
- **No decision-driven re-planning.** An answer resumes the interrupted stage; it never
  rewires the pinned graph, skips a stage, or changes a verdict already recorded.
- **No structured answer forms.** Options are labelled choices plus free text, as the result
  contract already defines them — no schemas, no typed fields, no validation of the answer
  against the question.
- **No retention policy.** Resolved decisions accumulate as history for the Retro agent;
  pruning them is not in scope.
