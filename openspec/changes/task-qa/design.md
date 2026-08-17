## Context

See `proposal.md` for motivation. The archived `task-surface` supplies authenticated REST, an
ordered resumable event stream, feedback capture, and a chat-shaped timeline. The archived
orchestrator and runner changes supply durable stage attempts, labeled executions, timeouts,
usage telemetry, disposable worktrees, and cleanup to the last accepted commit.

The superseded implementation models each owner question as one `asks` row and one detached
answer run. Its role and snapshot isolation are useful substrate, but its queue, endpoints,
prompt, and UI deliberately erase prior turns and cannot steer a task. Because that schema has
not shipped, this design replaces it rather than adding a compatibility layer.

The binding constraints are:

- pipeline stages remain artifact-and-ledger driven and never inherit transcripts;
- only the orchestrator changes task or stage state;
- conversation execution never writes the task branch;
- every effect from conversation is explicit, versioned, attributable, and recoverable from the
  store;
- a user interruption discards an incomplete attempt instead of trying to merge it.

## Goals / Non-Goals

**Goals:**

- A follow-up is an incremental turn in the same durable conversation.
- Conversation remains available while a pipeline stage runs.
- Warm provider/runtime state reduces repeated setup without becoming authoritative.
- The owner can deliberately turn agreed guidance into a safe, observable task action.
- Restarting current work has race-free semantics and never consumes the failure cap.

**Non-Goals:**

- Converting the pipeline stage protocol into an interactive provider protocol.
- Preserving or reviewing uncommitted edits from an interrupted attempt.
- Letting an assistant directly invoke task mutations without owner confirmation.
- Sharing one conversation across tasks or treating a transcript as an artifact.

## Decisions

### The durable aggregate is conversation, message, response attempt, and action

`conversations` owns task and optional subject scope, lifecycle, last sequence, context anchor,
summary metadata, and opaque provider-session metadata. `conversation_messages` is the ordered
transcript: owner, assistant, and system entries share one sequence; an assistant entry carries
its response status and attempt telemetry. `conversation_actions` stores proposals and their
confirmation/application lifecycle separately from prose.

The separation is intentional. Messages are append-only communication; actions are idempotent
commands with expected versions. Editing an assistant message can never manufacture an action,
and replaying the transcript never re-applies one. The tables, not provider session storage, are
the recovery boundary.

The old `asks` row cannot be stretched into this aggregate without turning one row into a thread,
message, response job, and usage ledger simultaneously. It is replaced before release.

### The answer-only role becomes a conversational guide

The existing answer-only catalog slot stays read-only but its input and output widen. It receives
the current owner message, stored conversation context, task ledger, declared artifacts, and
product-code diff. It writes one assistant message plus zero or more structured action proposals
into runner scratch, alongside `RESULT.json`.

The guide has no mutation tools and no writable artifact kinds. Mechanical snapshot disposal is
still the final boundary if it writes or commits despite the prompt. A proposal names an action
kind and arguments, but the runner cannot apply it.

### Conversation context is anchored, incremental, and reconstructable

The first response assembles full task context at the task branch's current commit. The
conversation stores that anchor. A later response receives messages since the recorded summary,
the summary itself when one exists, and task-state/artifact/code deltas since the prior anchor.
After assembly, the anchor moves to the snapshot served to that turn.

An opaque provider session reference may preserve provider-side cached context. A configured
idle TTL may also keep one runtime warm. Both are accelerators: expiry, eviction, provider
failure, or orchestrator restart clears them and rehydrates from the transcript, summary, and
current task snapshot. At most one response per conversation runs, so summary position and anchor
advance in message order.

A rolling summary is created only at a stable message boundary and records the highest sequence
it covers. The full transcript is retained. This bounds prompt growth without making an
uncheckable provider transcript the source of truth.

### Conversation snapshots and stages may coexist

Responses use disposable detached worktrees keyed by conversation and response attempt. They do
not require the task's primary worktree to be idle, so a response can run while a stage does.
Conversation concurrency is configured separately from stage concurrency; resource policy may
delay a response globally, but a task's stage does not impose a workspace lock on it.

The response header names its task state and anchor commit. It cannot see a stage's uncommitted
work. If the stage commits while the response runs, that answer remains honest about its older
anchor and the next turn receives the delta. This is preferable to waiting until the pipeline
reaches a gate and presenting a fresh-looking answer much later.

### Confirmed actions are the only bridge into execution

The guide emits proposals such as `answer_decision`, `dismiss_decision`, `approve_gate`,
`redirect_gate`, `rework_gate`, `instruct_next_run`, or `restart_stage`. Each proposal includes
the task version and, when relevant, decision, gate, or stage identity it was based on.

Confirmation creates an immutable action record under the task advisory lock. The orchestrator
compares the expected identity with live state and either delegates to the existing owning
operation or records a conflict. The API never performs the transition itself. An action has an
idempotency identity, so retrying a confirmation returns the first outcome instead of applying it
twice.

Confirmed instructions are rendered into the task ledger with their action identity and target.
The target stage records which instructions it consumed. The transcript itself never enters a
pipeline prompt, which preserves REQ-102 and makes the exact steering signal reviewable.

### Stop is immediate; restart is a separate protocol step

The running-stage surface exposes `stop_stage` without involving the guide. It carries the exact
stage id, graph id, node key, and attempt. Under the task lock, the orchestrator conditionally
changes that attempt from `running` to `interrupted`, moves the task to `paused` with the same
node as `resume_status`, and records the stop operation. If the conditional update loses to
normal completion, the stop becomes a conflict and stops.

After the database claim wins, the orchestrator terminates only the execution labeled with that
task, node, and attempt. It waits for the runner promise to settle, discards the primary worktree
to the task branch's last accepted commit, and verifies it is clean. Only then does it mark the
stop applied and leave the task safely paused. A later `restart_stage` operation may include a
new instruction entered in the restart form or one selected from a conversation proposal. The
owner confirms the exact text and interrupted target; the orchestrator stores that intervention,
returns the task to the stored graph node, and lets the normal tick create a new attempt. Only the
confirmed instruction and its action identity enter the ledger, never the surrounding transcript.

External termination and workspace cleanup cannot be atomic with Postgres. The intermediate
`paused` state is the safety barrier: a crash or cleanup error cannot dispatch a replacement over
an execution or dirty tree that may still exist. Recovery resumes the same termination and
cleanup protocol from the stored stop. Separating restart also gives the owner an emergency stop
that does not depend on composing guidance or waiting for a conversational turn.

Every completion path updates a stage only while it is still `running`. If an interrupted runner
returns success late, that compare-and-set fails; its result is not committed or advanced. This
guard is required even after an execution kill because exit and confirmation may race.

### Interrupted is an outcome, not a failure

The stage status set gains `interrupted`. It records start and finish times, the owner/action that
interrupted it, and whatever provider usage was already available. Missing token or cost data is
absent, never zero. Its duration and disclosed cost count toward task spend because the work ran.

Failure-cap queries count only trailing `failed` attempts. An interrupted attempt increments the
node's attempt number for uniqueness and history but neither increments nor resets the failure
streak. This makes repeated owner steering visible without turning it into provider instability.

### The task stream transports durable state, not partial completions

REST creates conversations, appends messages, reads transcript state, and confirms actions.
Events announce durable transitions: conversation/message creation, response start/completion or
failure, action proposal, confirmation, conflict, application, and failed cleanup. The existing
stream cursor and client invalidation pattern carry them.

No token-by-token SSE is added. A partial provider completion is neither durable nor safe to use
as an action proposal. The UI may show that a response is active, then render its complete stored
message.

The task view projects the pinned graph rather than reconstructing progress from prose. It marks
the current node, attempt number, accepted commit, and `running`, `stopping`, `paused`, or terminal
state. Its chronological activity timeline carries durable stage, stop/cleanup/restart,
conversation, action, decision, and accepted-artifact events. It is not a live filesystem or
terminal feed: a running attempt's uncommitted edits remain invisible and cannot be presented as
accepted changes. When a stage completes and its commit is accepted, the completion event points
the client at the new commit and refreshed artifacts.

## Risks / Trade-offs

- [A concurrent answer is stale before it arrives] → every answer displays its state and commit
  anchor; the next turn receives the delta, and actions use expected versions.
- [Provider sessions are not portable or may expire early] → they are optional cache metadata;
  durable context always reconstructs a turn.
- [A long conversation still grows expensive] → summaries bound old transcript input, task
  context is sent as deltas, and telemetry distinguishes cached from reconstructed paths.
- [Termination wins but the execution cannot be killed] → the task remains paused and recovery
  retries exact-label cleanup; no replacement starts.
- [An agent commits during a stage before interruption] → only orchestrator-accepted stage output
  is a restart boundary; the workspace is restored to the recorded accepted task commit.
- [Frequent user restarts waste spend] → each interrupted attempt remains visible in history and
  budget totals, and confirmation states the cost and discarded-work consequence.
- [Action proposal schemas become a second pipeline language] → the set is closed and every
  action delegates to an existing orchestrator operation; adding a new effect requires a new
  explicit contract.

## Migration Plan

1. Replace the unshipped asks migration and schema with conversations, messages, actions, the
   `interrupted` stage status, and conversation/intervention feedback kinds.
2. Land store and core contracts before switching runner/orchestrator dispatch; existing ask code
   is removed rather than kept as a compatibility path.
3. Land API and web against the conversation endpoints in the same release; no client is directed
   to the superseded ask endpoints.
4. `decision-records` archives afterwards and creates decision-scoped conversations using the
   subject contract defined here.
5. Rollback uses the previous application and schema revision; no released conversation data
   requires conversion.
