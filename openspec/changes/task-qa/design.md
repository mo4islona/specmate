## Context

See `proposal.md` for motivation. This change assumes two in-flight changes as its floor:
`task-surface` (SSE stream, feedback capture, the timeline and its comment input) and
`orchestrator-loop` (the tick loop, runner execution through `@specmate/runner`, the
telemetry shape on stage attempts). The workspace layer already has everything an intruding
read-only run needs: idempotent provisioning, discard-to-last-commit, and the rule that
runner scratch never enters a commit.

The binding constraints: fresh context per run (no transcripts), agents never set task
state, pipeline stages own the workspace when they run, and every run ends with a
`RESULT.json` naming a catalog role.

## Goals / Non-Goals

**Goals:**
- Clarification that costs one agent run, not one rework round.
- Zero new transport: asks ride the existing store, stream, and runner.
- The Q&A history reconstructable from the store alone (`asks` table), the live experience
  carried by events.

**Non-Goals:**
- No conversational memory of any kind — not even server-side "include last N asks in
  context". Quoting is the client's affair.
- No generalization to "ask about anything" — context assembly is the task's change folder
  and workspace, full stop.

## Decisions

### `answerer` is a catalog role, not an execution mode

The run must end with a `RESULT.json` naming a catalog role, roles carry the capability bits
the runner enforces mechanically, and prompts live in `roles/*.md`. Making the answerer a
first-class entry (`roles/answerer.md`, may-modify-code: false, artifact writes: none) gets
all three for free; an "answer mode" flag on existing roles would need a parallel enforcement
path for "this run may write nothing". The contract carve-out lives in the `agent-contracts`
delta: answer-only roles produce an answer instead of artifact changes.

### The answer travels through runner scratch

The answerer writes `ANSWER.md` next to `RESULT.json` in the per-run scratch area — already
excluded from commits by the workspace contract — and the runner reads it back as the run's
product. Alternatives: stuffing the answer into `RESULT.json` (its `notes` field is a short
human-facing note, not a document; abusing it couples answer length to result parsing) or
committing an answer artifact (asks must leave no trace on the branch).

### The `asks` table is the queue

No new queue infrastructure: `asks` rows in `pending` are the work list, exactly as runnable
tasks are for stages. The orchestrator's existing tick gains one step: for each task whose
workspace is idle (no stage running or scheduled this tick), take the oldest pending ask,
mark it `answering`, run it, discard the workspace, store the answer, append the event.
Stages are scheduled before asks within a tick, which is the whole priority policy. Restart
recovery mirrors stages: an `answering` ask with no live run behind it is a failed attempt,
re-run under the single-retry cap.

### Telemetry shape is shared, storage is local

Each answering attempt records the same structured usage record as a stage attempt (model,
timings, token kinds, cost) — same TypeScript type from `packages/core` — but stored on the
ask row, not in `stages`: asks are not stages, and giving them stage rows would leak them
into the pinned graph, iteration counting, and every stage query. "Task spend" queries union
the two.

### API and UI reuse the comment path's shape

`POST /api/v1/tasks/:id/asks` and `GET /api/v1/tasks/:id/asks`, validation and structured
errors as in `task-surface`; events `ask.created`, `ask.answered`, `ask.failed` flow through
the existing stream and TanStack Query invalidation. In the task view the input becomes a
segmented control (comment | ask); the timeline renders an ask as a question entry with a
pending pulse — the mission-control theme's one ornament, reused — that resolves into the
answer rendered as markdown (same `react-markdown` setup, raw HTML disabled: the answer is
agent output).

### Questions mirror into feedback at post time

The `question` feedback row is written by the API in the same transaction as the ask row —
not by the run, not on answer. The signal is the question's existence; an unanswered or
failed ask is still signal that the artifacts left something unclear.

## Risks / Trade-offs

- [An ask can wait a long time behind a busy pipeline] → accepted: asks are advisory by
  contract; the pending state is honest in the UI. If it stings in practice, a per-task
  "answers allowed during stage X" policy is a later, compatible refinement.
- [The answerer reads the workspace while frozen mid-pipeline, so answers can describe
  not-yet-reviewed work] → accepted and arguably the point; the answer entry in the timeline
  is labeled with the stage the task was in when it ran.
- [Owner asks could become a de-facto steering channel ("do it differently"), bypassing
  feedback semantics] → the answerer's prompt instructs it to answer, not to promise
  changes, and to point at redirect/rework for action; the question is captured as feedback
  either way, so the signal isn't lost.
- [Two changes touching the feedback-kinds requirement] → explicit archive order
  (`task-surface` first) stated in the proposal; the delta here contains the full merged
  text so archiving is mechanical.
- [Ask spend is invisible to budget caps until Phase 2] → recorded and attributed from day
  one, so enforcement lands on complete data.

## Migration Plan

1. One migration: the `asks` table plus the `question` enum value — additive; deploys after
   the `task-surface` migration by the stated change order.
2. Orchestrator and API deploy together (shared ask operations in `packages/core`); the UI
   affordance is inert against an older API only until the next compose up, and fails as a
   structured 404, not silently.
3. Rollback: previous images; the table and enum value stay behind harmlessly.
