## 1. Persistence

- [x] 1.1 Add `comment` to the `feedback_kind` enum in `packages/db/src/schema.ts` and generate the migration (`bun run db:generate`; inspect the new SQL file for a single additive `ALTER TYPE`)
- [x] 1.2 Extend the db test suite to insert a `comment` feedback row with null role/provider and one pinned to a stage (verify: `bun test packages/db`)

## 2. Task surface — reads

- [x] 2.1 Structured error helper: stable error codes (`validation`, `unauthenticated`, `not_found`, `conflict`, `internal`) with detail, used by every route (verify: existing routes' error responses carry `code`; `bun test apps/api`)
- [x] 2.2 Task list and task detail endpoints — detail includes the pinned run graph and stages (verify: api test creates a task, reads detail, asserts graph and stages present; 404 carries `not_found`)
- [x] 2.3 Artifact endpoints: list per task (path, kind, updated) and single-artifact snapshot content (verify: api test seeds an artifact row and reads both)
- [x] 2.4 Stage telemetry in stage reads: model, timings, token usage by kind, cost; absent telemetry serialized as absent, not zeros (verify: api test with one stage with telemetry and one without)
- [x] 2.5 Attention endpoint aggregating gate-parked, failed, and stalled tasks with reason and since-when; stall threshold from `SPECMATE_STALL_HOURS` default 4 (verify: api test seeds all three cases plus a healthy task, asserts exactly three items; empty store yields `[]`)

## 3. Task surface — stream

- [x] 3.1 SSE endpoint scoped to one task or all tasks: replays `seq > cursor` from `Last-Event-ID`, then polls live; every event's SSE `id` is its `seq`; heartbeat comments (verify: api test connects with a cursor, appends events, asserts ordered no-gap no-duplicate delivery)
- [x] 3.2 Stream auth: bearer required, query-string credential rejected as unauthenticated (verify: api test for both refusals)

## 4. Task surface — writes

- [x] 4.1 Feedback endpoint: comment on a task, optional stage pin copying the stage's role/provider; writes `feedback` kind `comment` and appends an event; empty comment rejected (verify: api test asserts feedback row, event row, and 400 for empty)
- [x] 4.2 Gate endpoints (`approve`, `redirect`, `rework`) delegating to the `packages/core` gate operations; redirect/rework require a non-empty comment recorded as feedback of the matching kind; non-parked task yields `conflict` and no state change (verify: api test with a parked fixture and a running fixture)
- [x] 4.3 Task intake validation errors name every offending field (verify: api test posts a body missing title with an unknown type, asserts both named)

## 5. Web foundation

- [x] 5.1 Wire `wouter`, TanStack Query, and the `hono/client` typed client against the exported `AppType`; Vite dev proxy for `/api` (verify: `bun run --cwd apps/web typecheck`; dev server proxies to a running api)
- [x] 5.2 Secret gate component: prompt on missing secret, store in `localStorage`, attach as `Authorization` header everywhere, clear-and-reprompt on 401 (verify: open app without a secret → prompt; wrong secret → reprompt)
- [x] 5.3 SSE consumer over `fetch` with the hand-rolled parser: resume from last `seq`, feed TanStack Query (append to timeline, invalidate named queries), expose connection state (verify: web test with a mocked stream asserting resume cursor and dedup)
- [x] 5.4 Mission-control theme tokens in Tailwind 4 `@theme`: ground/elevation colors, phosphor accent, amber/red/cyan semantic colors, status color map, JetBrains Mono + grotesk stacks; no raw hex in components (verify: grep components for `#` hex literals finds none; screens render on tokens)
- [x] 5.5 App shell: sidebar task list grouped by status with needs-input pinned and highlighted, URL routes for all four screens (verify: deep-link each route in a fresh tab)

## 6. Screens

- [x] 6.1 Attention Inbox: renders every attention item with task, reason, age, deep link to the acting place; explicit empty state (verify: seeded store shows items; empty store shows the empty state)
- [x] 6.2 New-task screen: form posts intake, navigates to the created task, task list updates without reload; field errors from the validation response shown in place with input preserved (verify: submit valid and invalid forms in the browser)
- [x] 6.3 Task view timeline: chronological humanized events, live append from the stream, stale-connection indicator, no gaps or duplicates after reconnect (verify: run a task, watch events arrive; kill and restore the api mid-watch)
- [x] 6.4 Gate action bar: visible only when parked; approve resumes; redirect/rework refuse empty comment and their comment appears in the timeline (verify: browser against a parked fixture task)
- [x] 6.5 Comment input on the task view with optional stage pin; posted comment appears in the timeline without reload (verify: post pinned and unpinned comments in the browser)
- [x] 6.6 Artifacts screen: artifact list by kind, selected artifact rendered with `react-markdown` + `remark-gfm`, raw HTML disabled (verify: seed an artifact containing a `<script>` tag — renders inert)
- [x] 6.7 Telemetry chart with `@wick-charts/react` (exact pin): stacked token-kind bars plus duration per stage attempt, themed via `createTheme()` from computed CSS custom properties; attempts without telemetry listed beside the chart; explicit no-telemetry empty state (verify: browser against tasks with and without telemetry; canvas colors match the page)
- [x] 6.8 Phone-sized pass over all four screens: no horizontal page scroll, gate actions and comment input operable at 390px width (verify: responsive mode at 390×844 on each screen)

## 7. Deployment & CI

- [x] 7.1 nginx proxy in the web container for `/api/*` → api service, same-origin in prod as in dev (verify: `docker compose up`, browse the UI on the web port, API calls succeed without CORS headers)
- [x] 7.2 Full check green: `bun run ci` (verify: command exits 0)

## 8. End-to-end

- [x] 8.1 Phase-1 exit rehearsal: launch a task from the browser, watch it live, comment mid-run, act at a gate, read an artifact, check the telemetry chart — phone viewport included (verify: scripted walkthrough notes in the PR description)
