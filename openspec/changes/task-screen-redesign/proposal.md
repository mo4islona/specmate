## Why

Phase 3 of the roadmap (docs/plan.md §14, "UI v1") owns the shape of the task view. The
screen it has today grew one panel at a time and reads like a dump of the data model: nine
bordered panels of equal weight stacked down the page — gate, decisions, running stage,
budget, per-role models, pinned pipeline, timeline, telemetry, conversation — with nothing
telling the owner which of them needs them right now. The owner named the specific failures:

- the per-role model table repeats one binding nine times, when the only thing worth
  seeing is the role that departs from it;
- the pinned pipeline sits in the page flow, scrolling away exactly when it is needed as
  orientation;
- the timeline grows without end and never resolves into "what happened at which stage" —
  it does not read as a conversation with the agent working the task;
- there is no way to go back to an earlier stage and read what it did;
- `attempt 0` is printed on every node, though a first attempt is the ordinary case and
  carries no information;
- `accepted 8578f21ffca22c4ca5782d452468b2a1a56828f0` — a full hash with no link and no
  explanation of what it accepted.

Every one of these is a rendering problem over data the client already holds; none of them
needs a new read. This change reshapes the task view around one question — *what needs me,
and what has this task been doing?* — and leaves the underlying contract untouched.

## What Changes

- `operator-ui` REQ-914 is amended: the pinned pipeline moves into a rail pinned beside the
  thread, listing every node with its live status; the node the task stands on is marked,
  and activating any node reveals that node's runs — status, duration, tokens, cost, and
  accepted commit — in place. Each stage node names its role, and names its model binding
  only where that binding departs from the task's baseline, which the rail states once.
  This replaces the standalone per-role model table (REQ-903/AC-948 is unaffected: an
  override stays visible on the task view, on the node it governs).
- `operator-ui` REQ-914 is amended: an attempt number is shown when a node has run more
  than once. A single run is presented as the run itself, not as "attempt 0".
- `operator-ui` REQ-914 is amended: an accepted commit is rendered as its short form,
  linked to the commit on hosts whose web address is derivable, with the full hash
  available on the element.
- `operator-ui` gains REQ-918: the timeline is grouped into per-stage chapters — the task's
  history as a chaptered conversation. Only the newest chapter is open; the rest collapse to
  one line each carrying that stage's duration, tokens, cost, and commit. Owner comments and
  conversation turns fall into the chapter of the stage that was running when they were
  written, so the task conversation and the run ledger stop being two separate lists.
  Activating a pipeline node opens that node's chapter.
- `operator-ui` REQ-912 is amended: an open decision's card is presented where the owner
  acts — above the thread, alongside the gate and run controls — and takes its place in the
  thread once resolved.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `operator-ui`: REQ-914's pipeline readout becomes a pinned rail with per-node status,
  activation, role and departing model binding; attempt numbering and commit rendering
  change as above. REQ-912's decision cards move to where the owner acts while open. A new
  REQ-918 defines the chaptered thread. Every other requirement is unchanged.

## Impact

- `apps/web` only. No API change, no schema change, no new dependency: the rail, the
  chapters, and the per-node detail are all derived from what `task-surface` REQ-1002/AC-1004
  already returns on a task read and from the event stream that already drives the timeline.
- `apps/web/src/components/model-bindings-panel.tsx` is removed — its content now lives on
  the pipeline nodes.
- The task view's own tests move with the logic: the pure grouping, labelling, and link
  derivation are unit-tested (`apps/web/src/lib/task-thread.ts`, `task-pipeline.ts`,
  `repo-link.ts`).

## Non-goals

- No node-and-edge topology. The rail lists the pinned pipeline in order; drawing forward,
  loop, redirect, and rework edges as a diagram remains the separate `dag-visualization`
  change, whose per-node status and node-activation goals this change delivers in list form.
- No new data. Nothing here asks the API for a field it does not already return — in
  particular, no pull-request URL on the task read, and no stage-scoped artifacts.
- No change to what a running attempt may show. REQ-915's boundary between live activity and
  accepted state is preserved exactly as it stands.
- No redesign of the inbox, the new-task form, the artifacts view, or Settings.
