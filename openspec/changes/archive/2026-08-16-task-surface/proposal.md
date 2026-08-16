## Why

Phase 1 of `docs/plan.md` deliberately ships the UI with the first pipeline, not after it: the
human's comments are the self-learning signal, and they arrive through a browser. Today the
signal has nowhere to arrive. The API is a Phase-0 stub — create a task, list tasks, poll an
event page — and `apps/web` renders a placeholder. The orchestrator loop being built next door
parks tasks at gates and exposes approve/redirect/rework only as programmatic operations, so
"a real bugfix goes end-to-end launched and commented entirely from the UI" (the Phase-1 exit)
is currently impossible: there is no surface to launch from, no live view to watch, and no
input that lands in the `feedback` table.

This change builds that surface: the full Phase-1 HTTP contract (REST plus a live SSE event
stream) and UI v0 — four screens, deliberately small but not deliberately ugly. Two deviations
from the plan's letter are intentional and named here: the plan says "no polish" and suggests
shadcn/ui, while this change ships a distinctive Tailwind theme instead of a stock component
kit; and the plan defers the stage-telemetry debug chart to "later UI work", while this change
includes it, rendered with `@wick-charts/react` — the owner's own charting library — because
dogfooding it here is exactly the kind of real-world exercise the library needs.

## What Changes

- The task surface in `apps/api`: task intake (create with title, type, repo, branch) and
  reads (list with status, detail with pinned graph and stages), a live event stream over SSE
  with cursor resume from the append-only `events` table, artifact reads (list and content for
  rendering), stage reads carrying the execution telemetry the orchestrator loop records
  (model, timings, token usage, cost), and an attention endpoint aggregating everything that
  needs the human right now.
- Gate operations over REST: approve, redirect-with-comment, and rework-with-comment on a
  parked task call the same programmatic operations the orchestrator-loop change defines —
  the API adds no transitions of its own. Comments ride along as structured feedback.
- Operator feedback as a first-class write: a comment can be posted on a task or pinned to a
  specific stage from any screen, landing in the `feedback` table from day one — before the
  Retro agent exists to read it. Free-form commentary gets its own feedback kind, `comment`,
  distinct from the gate-verdict kinds.
- UI v0 in `apps/web`, four screens: **Attention Inbox** (the home screen — every parked task
  and open item, one tap from its action), **task view** (chat-style timeline fed by the SSE
  stream, gate action bar when parked, feedback input always present), **new task** (the
  intake form), and **artifacts** (rendered markdown for the change folder's documents).
- The stage-telemetry debug chart in the task view: where time and tokens went, per stage and
  attempt, rendered with `@wick-charts/react`; the chart theme derives from the app theme via
  `createTheme()` so the canvas does not look pasted in.
- A distinctive Tailwind 4 theme — design tokens as CSS custom properties under `@theme`, an
  intentionally non-default direction (not shadcn, not a template), specified in `design.md`
  and shared with the chart theme.

## Capabilities

### New Capabilities

- `task-surface`: the authenticated HTTP contract between the store and any client — task
  intake and reads, the ordered SSE event stream with resume, artifact and stage-telemetry
  reads, gate operations, feedback capture, and the attention aggregation.
- `operator-ui`: what the four screens must let the single owner see and do — launch, watch
  live, read artifacts, act on gates, and comment on everything — from a browser or a phone.

### Modified Capabilities

- `persistence`: the closed set of feedback kinds gains `comment` — free-form operator
  commentary not tied to a gate verdict or a decision answer.

## Impact

- `apps/api`: the Phase-0 stub routes grow into the full contract above; SSE keeps the
  bearer-token rule (no query-string tokens, no auth exemptions — how, is a design.md
  concern). Gate endpoints call operations from `packages/core`/`@specmate/db` shared with
  the orchestrator; the API never mutates task state through a side channel.
- `apps/web`: from placeholder to a real client — router, API client with the SSE consumer,
  the four screens, the theme, and an nginx runtime for static assets plus the same-origin
  API proxy. New dependencies: `@wick-charts/react`, a markdown renderer, a client-side router.
- `packages/db`: one enum migration (`feedback_kind` + `comment`); no table changes — every
  table this surface reads and writes already exists.
- Depends on the `orchestrator-loop` change for gate operations and stage telemetry; degrades
  gracefully where it can (an empty telemetry chart is fine, a gate action bar with nothing
  parked is fine).
- No new services, no Compose topology change: the web client stays a static build, the API
  stays the single authenticated process in front of Postgres.

## Non-goals

- No decision records UI. Decision cards, open-question answering, and `WAITING_HUMAN`
  driven by decisions are Phase 2; this change's gate action bar covers only the three
  mandatory gates the orchestrator loop already parks on.
- No DAG rendering, no artifact diff-since-last-approval view, no D2/Mermaid rendering —
  Phase 3 UI polish. Artifacts render as plain markdown.
- No notifications of any kind (browser push, Slack, Telegram) — Phase 2 per the plan; the
  Attention Inbox is the pull-based stand-in until then.
- No provider presets, budgets, or caps in the new-task form — intake carries exactly what
  Phase 0 defined (title, type, repo, branch); the rest keeps its defaults.
- No PR tracking items in the inbox (Phase 3) and no auth-expiry or budget warnings in it
  (their sources do not exist yet); the inbox aggregates only what the store can already say.
- No aggregation endpoints beyond the attention list — the telemetry chart reads per-task
  stage rows, not cross-task rollups; the metrics dashboard is Phase 8+.
- No mobile app and no offline behavior — responsive layouts are in scope, PWA is not.
