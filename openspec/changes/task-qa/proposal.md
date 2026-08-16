## Why

Every channel from the human to an agent today mutates the task: redirect regenerates the
brief, rework re-runs stages, a comment waits for the Retro agent. There is no way to simply
ask — "why did research choose X?", "what happens to Y under this design?" — and get an
answer without touching the pipeline. So clarification either doesn't happen or gets forced
through rework, the most expensive channel available. The questions themselves are also lost
signal: what the owner has to ask is exactly what the artifacts failed to make clear.

This change adds asks: one-shot, read-only question-and-answer runs over a task's artifacts.
It sits between Phase 1 and Phase 2 and is not in the `docs/plan.md` roadmap — a deliberate
addition, stated here per the house rule. It deliberately does not add chat: each ask is a
stateless run with fresh context assembled from the change folder, exactly like any stage, so
the "context lives with the task" discipline survives contact with a conversational feature.

## What Changes

- **Asks as first-class records**: a question posted on an active task is stored durably with
  a lifecycle (`pending → answering → answered | failed`), answered asynchronously, and
  mirrored into `feedback` as a new `question` kind — the self-learning signal pattern every
  other human interaction already follows.
- **An `answerer` role** in the catalog: reads the change folder and the ledger, receives the
  question, produces an answer — and may write nothing: no artifacts, no code, no task state.
  This is the first role whose output is not artifact changes, which requires carving an
  answer-only run shape into the agent contract.
- **Execution outside the pinned graph**: the orchestrator picks up pending asks and runs
  them in the task's workspace when no stage is using it — pipeline stages always win; asks
  queue and never preempt, block, or advance the pipeline. Any stray modification the run
  leaves is discarded, nothing is committed.
- **Answer delivery over the existing surface**: the answer lands in the ask record and as an
  event, so the task-surface stream carries it to a watching client with no new transport.
- **UI**: the task view's comment input gains an "ask" action; the timeline renders the
  question immediately, shows the ask's progress, and renders the answer when it arrives —
  visually distinct from comments.
- **Cost honesty**: each ask records the same execution telemetry as a stage attempt (model,
  timings, token usage, cost) and its spend counts as the task's spend.

## Capabilities

### New Capabilities

- `task-qa`: what an ask is — how a question is posted, stored, and mirrored to feedback; the
  read-only, stateless, non-preempting execution contract; how the answer is delivered and
  read; how asks are surfaced and submitted in the task view.

### Modified Capabilities

- `agent-contracts`: the "every role consumes and produces OpenSpec artifacts" requirement
  gains the answer-only run shape — a role may be declared answer-only, consuming artifacts
  and a question and producing a structured answer instead of artifact changes.
- `persistence`: asks become durable records with a status lifecycle, removed with their
  task; the closed set of feedback kinds gains `question`.

## Impact

- Ordering: this change layers on the in-flight `task-surface` change (stream, feedback
  capture, timeline) and `orchestrator-loop` (runner execution, telemetry shape). Its
  `persistence` delta touches the same feedback-kinds requirement `task-surface` modifies, so
  it MUST archive after `task-surface`; the delta here is written against that future text.
- `packages/db`: a new `asks` table and a `feedback_kind` value — one migration.
- `packages/core`: the `answerer` catalog entry (read-only capability bits) and ask
  operations shared by API and orchestrator.
- `apps/orchestrator`: an ask executor on the existing tick — queue scan, workspace-idle
  check, discard after run.
- `packages/runner` / `roles/`: the answer-only run shape (question in, answer out through
  the runner scratch area, `RESULT.json` as always) and `roles/answerer.md`.
- `apps/api` / `apps/web`: two endpoints (post ask, list asks), two-ish event types, and the
  ask affordance in the task view.

## Non-goals

- **No chat.** No threads, no transcript, no follow-up context: a follow-up is a new ask; the
  UI may quote the previous answer into the question text, which costs nothing and keeps runs
  stateless.
- **No influence on the pipeline.** An answer never changes task state, artifacts, or gate
  outcomes; if an ask reveals something that should change the work, the existing channels —
  redirect, rework, gate comments — are the way to act on it.
- **No asks outside a live task**: terminal tasks (archived, cancelled) refuse asks — their
  workspace is gone and their artifacts are frozen; the wiki is the record there.
- **No token-by-token streaming of the answer** — it arrives whole, as an event; the SSE
  channel stays an event log, not a completion stream.
- **No budget enforcement** — ask spend is recorded and attributed, but caps act on it only
  when Phase 2 budget enforcement lands; nothing here blocks an ask on cost.
- **No cross-task or repo-wide Q&A** — an ask is scoped to one task's change folder and
  workspace; "ask about the codebase in general" is a different feature with different
  context assembly.
