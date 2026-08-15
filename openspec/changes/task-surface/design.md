## Context

See `proposal.md` for motivation. What exists today: `apps/api` is the Phase-0 stub (create
task, list tasks, page of events) behind the single-owner bearer secret; `apps/web` is a Vite
+ React 19 + Tailwind 4 placeholder served as a static container on its own port; every table
this change touches (`tasks`, `run_graphs`, `stages`, `artifacts`, `feedback`, `events`)
already exists, and `events.seq` is already the monotonic stream cursor. The in-flight
`orchestrator-loop` change contributes the two things this surface exposes but does not own:
programmatic gate operations and per-attempt stage telemetry. Compose binds everything to
loopback; remote access is over a private network.

Constraints that shape the design: one owner, one shared secret, no accounts; the API must
not grow a second way to mutate task state; the client must work from a phone; committed
artifacts are English.

## Goals / Non-Goals

**Goals:**
- One HTTP contract any client could consume; the UI holds no privileged path to the store.
- Live-by-default reading: the REST snapshot and the SSE stream compose without gaps.
- Every interactive element that accepts operator words routes them into `feedback`.
- A visual identity strong enough that v0 does not need to be replaced to stop being ugly —
  only extended.

**Non-Goals:**
- No generalized query API (filtering, pagination beyond simple limits, search).
- No offline cache, no optimistic writes beyond the comment input.
- No theming system with multiple themes — one committed look, tokens structured so a second
  theme is possible later without rework.

## Decisions

### SSE over fetch, not EventSource

The stream endpoint sits under `/api/` and therefore requires the bearer secret; the spec
forbids the secret in a URL. Browser `EventSource` cannot set an `Authorization` header, so
the client consumes SSE via `fetch` with a `ReadableStream` parser (a small hand-rolled one —
the format is three line types). The server side uses Hono's `streamSSE`. Resume: the client
sends the last processed `events.seq` (as `Last-Event-ID` on reconnect); the server replays
`seq > cursor` from the table before switching to live delivery, and every event's SSE `id`
is its `seq`, so the client always holds a valid cursor. Delivery inside an open connection
is a per-connection poll of the events table (~1s interval) — for a single owner with a
handful of connections this is noise; Postgres `LISTEN/NOTIFY` is the later optimization and
changes nothing in the contract. A comment-line heartbeat every ~15s keeps idle proxies from
reaping the connection.

Alternative considered: WebSocket — bidirectional transport for a unidirectional feed, plus
its own auth handshake; SSE reconnect-with-cursor is exactly the semantics the event log
already has.

### Gate operations are library calls, not RPC to the orchestrator

The API invokes the gate operations (`approve`, `redirect`, `rework`) as functions from
`packages/core` against the same Postgres the orchestrator watches; the orchestrator's next
tick observes the new state and continues. No HTTP channel between api and orchestrator, no
new failure mode, and the "API adds no transitions of its own" spec requirement is enforced
by construction — the API has no other write path to task state. The seam with the in-flight
`orchestrator-loop` change is exactly this module boundary; until its operations land, the
endpoints return the structured conflict error, which is also their long-term behavior for
"not parked here".

### Attention is a query, not a table

The attention list is computed per request: tasks in a gate-parked status (with the gate and
parked-since from the pinned graph and the event log), tasks in `failed`, and tasks whose
latest event is older than `SPECMATE_STALL_HOURS` (default 4). Nothing is materialized —
the sources are all indexed reads, the owner is one person, and a stored inbox would need
invalidation logic the query makes unnecessary.

### Feedback: one new enum value, role attribution from the stage

`feedback_kind` gains `comment` (additive enum migration). A comment pinned to a stage copies
that stage's role and provider into the feedback row — attribution is resolved at write time,
when the stage row is at hand, not reconstructed later by the Retro agent. Unpinned comments
carry null role/provider; they still name the task.

### Web client architecture

- **Typed API client**: `apps/api` exports its Hono `AppType`; the web app consumes it with
  `hono/client` (`hc`) — end-to-end request/response types with zero codegen. The workspace
  dependency is type-only.
- **Router**: `wouter` — four screens, ~2 kB, no loader/data machinery to fight; the app's
  data layer is below. Alternative: react-router — its data APIs duplicate what the query
  layer does.
- **Data layer**: TanStack Query for REST snapshots; one SSE consumer feeds it — an incoming
  event appends to the open timeline query and invalidates the queries it names (task detail,
  artifact list, attention). This composes snapshot+stream without hand-rolled caches.
- **Markdown**: `react-markdown` + `remark-gfm`, raw HTML disabled — artifacts are
  agent-written; rendering them as inert markdown is the safety line.
- **Secret handling**: the secret lives in `localStorage`, entered through a gate component
  that wraps the router; any 401 clears it and returns to the prompt. It travels only in the
  `Authorization` header.

### Single origin via the web container's proxy

The web container's static server (Caddy) proxies `/api/*` to the api service. Browser and
API share one origin: no CORS surface, no preflight on the SSE fetch, the secret never
crosses origins. Vite's dev server proxies the same path, so dev and prod agree.
Alternative: CORS headers on the API — more configuration expressing less.

### The telemetry chart dogfoods wick-charts

`@wick-charts/react` (pinned exact version — it is 0.1.x) renders the stage chart: token
usage per stage attempt as a stacked bar (one segment per token kind), duration as a second
series. Attempts without telemetry are omitted from the series and listed as "no telemetry"
beside the chart, satisfying the absent-vs-zero requirement. Friction found here is filed
upstream against wick-charts — that feedback loop is the point of dogfooding, workarounds in
SpecMate are the last resort.

### Theme: mission control

One committed dark theme — a control-room look, not a component kit:

- **Tokens** (Tailwind 4 `@theme`, CSS custom properties): near-black green-tinted ground
  (`#0a0f0c` family, two elevation steps), phosphor green primary accent, amber for
  warning/parked, red for failed/destructive, desaturated cyan for links. Status colors form
  a fixed map used identically by chips, timeline entries, and chart series.
- **Type**: JetBrains Mono for data — identifiers, timestamps, numerals, event types;
  a plain grotesk (system stack) for prose and artifact rendering. Uppercase letterspaced
  micro-labels for section headers.
- **Surfaces**: flat, 1px hairline borders in a low-alpha accent, no shadows, radius 0 (a
  2px exception for inputs). The active/parked element gets the one allowed ornament: a
  subtle pulsing border, because "needs the human" is the state the whole UI exists for.
- **Charts**: `createTheme()` is fed by reading the resolved custom properties at mount
  (`getComputedStyle`), so the canvas and the DOM cannot disagree; token-kind series colors
  come from the status/accent ramp.

A light theme is explicitly not built; the token structure (semantic names, no raw hex in
components) is what keeps that door open.

## Risks / Trade-offs

- [`orchestrator-loop` lands after this change starts] → the seam is the `packages/core`
  gate-operation signatures and the telemetry columns; every consumer degrades to its
  specified empty/conflict state, so the surface is buildable and testable against a store
  where nothing is parked and nothing has telemetry.
- [wick-charts API churn at 0.1.x] → exact-version pin; changes arrive deliberately, and
  breakage becomes an upstream issue rather than a silent redraw.
- [Per-connection polling wastes cycles at scale] → accepted: the scale is one owner;
  the LISTEN/NOTIFY upgrade is invisible to clients.
- [Timeline renders raw events, which read like a log, not a chat] → accepted for v0: event
  types get humanized labels client-side; the Summarizer-lite per-stage prose is a later
  phase, and the events are the truthful floor beneath it.
- [Secret in `localStorage` is readable by any XSS] → markdown rendering disables raw HTML
  and the app embeds no third-party scripts; the deployment posture (private network) is the
  outer wall. Accepted for a single-owner tool.
- [Dark-only theme on a phone in daylight] → accepted; contrast ratios are kept ≥ WCAG AA
  so legibility degrades gracefully.

## Migration Plan

1. `feedback_kind` enum migration (additive) ships first; it is backward-compatible with the
   running orchestrator.
2. API deploys before or with the web build — the web container only proxies, so ordering
   inside one `compose up` is already correct.
3. Rollback is a redeploy of the previous images; the enum value stays behind harmlessly.
