## Why

The task surface looks conversational, but its agent channel is a sequence of unrelated
one-shot questions. Every follow-up rebuilds the same context, the agent cannot remember what
was just clarified, and a user's correction cannot affect work already under way. The same gap
would make an open decision answerable but not discussable: the owner would have to commit to an
answer before understanding it.

This change replaces asks with durable task conversations. It sits between Phase 1 and Phase 2
and deliberately extends `docs/plan.md`: a conversation may clarify work without changing it,
then turn an agreed message into an explicit task action. The pipeline remains artifact-driven;
conversation history reaches a stage only after the owner confirms an intervention that the
orchestrator records in the ledger.

## What Changes

- **BREAKING — asks become conversations**: the one-question `asks` model and endpoints are
  replaced before release by durable conversations, ordered messages, and recoverable response
  attempts. A conversation may be scoped to a task or to a process-created subject such as a
  decision or gate.
- **A conversational guide role**: the answer-only role reads a task snapshot, ledger, and its
  own conversation context, then produces an assistant message and optional structured action
  proposals. It may not modify files or task state.
- **Bounded session reuse**: one response runs at a time per conversation. A provider session and
  warm runtime may be reused within a configured idle TTL; Postgres remains authoritative and
  can rehydrate the conversation after expiry or restart. Artifact deltas since the
  conversation's context commit replace repeated full-context assembly where possible.
- **Conversation beside the pipeline**: a response uses a disposable snapshot and separate
  capacity, so it can answer while a stage owns the task worktree. The response names the commit
  and task state it understood; the next turn receives any intervening task and artifact changes.
- **Explicit influence**: an ordinary message never changes the task. The guide may propose an
  action, but only an owner-confirmed action may delegate to an existing decision or gate
  operation, attach an instruction to a future run, or interrupt and restart the current stage.
- **Direct stop, deliberate restart**: a running-stage control lets the owner stop execution
  without waiting for chat. The orchestrator marks that exact attempt interrupted, stops it,
  discards uncommitted changes, and leaves the task paused. Restart is a separate explicit action
  whose form may carry a newly entered instruction or a confirmed conversation proposal and
  re-enters the same graph node. Only the confirmed instruction reaches the replacement. An
  interrupted attempt is history and spend, but not a failure and not part of the retry cap.
- **Durable delivery and UI**: messages and actions are readable from the store and announced on
  the existing event stream. The task view presents the pinned pipeline with its current node and
  attempt, one conversation surface, action confirmation, failure/retry state, and the context
  version each answer used. Its activity timeline distinguishes durable state and accepted
  commits from a running attempt's invisible, uncommitted file edits.
- **Cost honesty**: every response attempt and interrupted stage retains the telemetry that is
  available. Conversation spend counts against the task's budgets; absent usage remains
  distinguishable from zero.

## Capabilities

### New Capabilities

- `task-qa` (REQ-1601–REQ-1608): durable task conversations, recoverable session context,
  read-only concurrent responses, explicit action confirmation, stop-and-restart semantics,
  delivery, and cost attribution.

### Modified Capabilities

- `agent-contracts`: REQ-102 gains the answer-only conversational run shape while preserving the
  rule that pipeline stages never inherit transcripts.
- `persistence`: fixed sets and cascades gain conversations, messages, actions, and the
  `interrupted` stage outcome; REQ-309 captures owner conversation and confirmed interventions
  as structured signal; REQ-312 defines the durable conversation aggregate.
- `task-lifecycle`: REQ-613 distinguishes an owner interruption from failure and excludes it from
  the failure cap.
- `workspace-lifecycle`: REQ-711 applies clean rollback to an interrupted attempt as well as a
  failed one.
- `task-surface`: conversations, messages, action confirmation, and conflicts are exposed over
  the authenticated API and existing resumable event stream.
- `operator-ui`: the task view gains a real multi-turn conversation and explicit intervention
  confirmation, plus a direct stop control on every running stage, including interrupt cost and
  destructive-work disclosure.

## Impact

- Ordering: after the archived `task-surface` and `orchestrator-loop` foundations; before
  `decision-records`, which creates decision-scoped conversations and relies on explicit
  resolution remaining separate from discussion. `budget-enforcement` counts conversation and
  interrupted-run spend through its provider-independent run rule.
- `packages/db`: replace the unshipped `asks` schema with conversations, messages, and actions;
  extend stage status and feedback kinds.
- `packages/core`: conversation operations, action contracts, context/version projection, and
  interruption state rules.
- `apps/orchestrator`: a conversation dispatcher, bounded session recovery, exact execution
  interruption, workspace rollback, and safe re-dispatch of the same node.
- `packages/runner` / `roles/`: a cancellable execution handle and conversational answer-only
  run shape whose product is a message plus proposed actions.
- `apps/api` / `apps/web`: conversation/message/action endpoints, events, hydrated transcript,
  and the confirmation UI.

## Non-goals

- **No live prompt injection into a running stage.** Influence is kill-and-restart from the last
  accepted commit, not pausing a provider process or continuing its private session.
- **No silent steering.** Neither user prose nor an assistant proposal mutates task state; every
  effect names and confirms an action.
- **No preservation of partial interrupted work.** Uncommitted edits are discarded; checkpoint
  commits and merging partial attempts are separate problems.
- **No cross-task or repository-wide assistant.** Every conversation belongs to one task and
  reads only that task's artifacts, ledger, and product-code diff.
- **No indefinite warm containers.** Runtime reuse is bounded by idle TTL and capacity; durable
  recovery never depends on a container surviving.
- **No token-by-token completion stream.** Durable message and action events remain the transport
  contract; partial model output is not authoritative.
- **No budget policy in this change.** Usage is recorded and attributed here; enforcement remains
  `budget-enforcement`.
