## Why

Phase 3 of the roadmap (docs/plan.md §14) is where the task view stops being a status board and
starts showing the owner what is actually happening. Today, between `stage.dispatched` and
`stage.completed`/`stage.failed`, the event log carries nothing else — checked every event type
the orchestrator emits (`stage.*`, `gate.*`, `conversation.*`, `decision.*`, `task.*`) and none
has per-tool-call or per-file granularity. An owner watching a running stage sees only "running"
for however long the attempt takes, with no sense of whether it is stuck, iterating, or making
progress. `agent-execution` REQ-206 already captures a run's full output to a log file, but only
for post-hoc retrieval after the run ends — nothing is surfaced while it runs.

## What Changes

- `agent-execution` gains a requirement: while a stage attempt runs, the runner parses the
  provider CLI's own structured streaming output and emits a durable, structured activity event
  per recognized action (tool name and target — e.g. "Editing src/foo.ts", "Running bun test").
  These are SpecMate's own summarized events, not the CLI's raw output relayed verbatim — chosen
  for a format that stays stable across providers as more are added (Phase 5), rather than
  leaking each CLI's own output shape into the event log and the UI.
- v1 targets Claude Code CLI's `--output-format stream-json` only, since it is the only provider
  runner that exists today (Codex/Copilot runners are Phase 5). The parser is written so a new
  provider adds a new source, not a redesign.
- `operator-ui` gains a new requirement for rendering these events in the task view's timeline,
  visually distinct from durable/accepted entries — consistent with REQ-914's existing rule that
  a running attempt's uncommitted work is never presented as accepted (AC-938). This is a new
  requirement rather than a change to REQ-914 itself: REQ-914 is already being modified by the
  in-flight `dag-visualization` change, and activity rendering is a distinct concern from the
  conversation/intervention surface REQ-914 covers. Activity events for an attempt are visually
  demoted (or cleared) once that attempt's result is accepted, so the timeline does not
  accumulate stale blow-by-blow noise for finished stages.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `agent-execution`: adds a requirement that a running stage attempt emits structured activity
  events as it proceeds, parsed from the provider CLI's own structured output.
- `operator-ui`: a new requirement renders live activity events in the task view, distinct from
  and subordinate to accepted/durable events.

## Impact

- `packages/runner`: the executor gains a line-oriented parser for Claude Code CLI's
  `stream-json` output, translating recognized tool-use entries into activity events appended to
  the event log as they occur (same `events` table the orchestrator already writes to —
  `type`/`payload` are free-form, so this is a new event type, not a schema change).
- `apps/web`: the task view's timeline renders the new event type distinctly and stops rendering
  an attempt's activity once that attempt's result is accepted.
- No `task-surface` change — the existing event stream (REQ-1003) already forwards every event
  type to connected clients.

## Non-goals

- No raw CLI stdout/stderr relayed to the event log or the UI — every activity event is
  SpecMate's own structured summary of a recognized action, never the provider's verbatim
  output. (Considered and explicitly declined by the user: a raw relay would be less code but
  ties the UI's rendering to each provider's own output shape.)
- No live diff or live file content of an attempt's uncommitted edits — REQ-914 already forbids
  presenting uncommitted work as accepted, and this change does not touch that boundary. Seeing
  the diff of what a stage actually changed, once its result is accepted, is the separate
  `code-diff-view` change.
- No Codex or Copilot activity parsing — those runners do not exist yet (Phase 5). Adding them
  is a follow-up once their headless CLIs exist to parse.
- No PR tracking, diagram rendering, artifact diffing, or Retro agent work — those are the
  separate `pr-tracking`, `diagram-rendering`, `artifact-diff-view`, and `retro-agent` changes
  tracked alongside this one in the Phase 3 breakdown.
