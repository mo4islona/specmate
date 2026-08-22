## Context

The task view reads five sources on every render: the task detail (`task`, `graph`,
`stages`, `spend`), the event window (last 200 events, merged with the SSE stream), the
conversation's messages and actions, the decision rows, and the artifact index. Before this
change all five were rendered as sibling panels down one column, each with its own border,
uppercase label, and heading — which is why nothing on the screen looked more important than
anything else.

Two of the owner's complaints are about grouping, not styling. The ledger never says *which
stage* an entry belongs to, and there is no way back to an earlier stage. The data to fix
both is already present: every stage-scoped event carries `stageId`, every stage row carries
`startedAt`/`finishedAt`, and every state change is an event carrying `from`/`to`.

## Goals / Non-Goals

**Goals:**
- One surface answers "what needs me now", and it is the only accented thing on the screen.
- The history reads as a conversation, chaptered by stage, closed by default.
- The pipeline is orientation: always visible, never scrolling away, and the way back to an
  earlier stage.
- Every number the owner reads is one they asked for (duration, tokens, cost, short commit)
  and none they did not (`attempt 0`, a 40-character hash, nine identical model rows).

**Non-Goals:**
- No new read, no new event type, no new dependency (see proposal Non-goals).
- No graph topology — that stays with `dag-visualization`.

## Decisions

**Chapters are derived from `stageId` plus the state timeline, not from a new field.**
`buildThread` walks entries (events and conversation messages together) in ledger order,
carrying the task's state as it goes. An entry belongs to a stage when it names one; failing
that, when it falls inside a stage's `[startedAt, finishedAt]` window while the task stands
on that stage's node — which is what puts an owner comment written mid-run inside the run it
is about instead of in a chapter of its own. Everything else falls to the state the task was
in, which is what makes a gate's approvals and comments read as the gate's own chapter.

Two ordering rules follow from this and are the whole of its subtlety: a state-moving event
is applied *before* its own placement, so "Parked for you" opens the gate's chapter rather
than trailing the stage that ran into it; and window matching is inclusive at both ends,
since an event stamped exactly at a stage's finish is that stage's last word, not a new
chapter's first.

**Silent events.** `stage.dispatched` and `task.transitioned` are dropped from the thread:
the chapter's existence *is* the dispatch, and its title *is* the transition. They still move
the state machine. This is a rendering decision — nothing is removed from the ledger, and the
events remain in the API's response.

**The newest chapter is open; toggles are stored as exceptions.** Storing which chapters are
open would fight the stream: a new chapter arriving would have to be added to the set, and an
old one the owner closed would have to survive. Instead the client stores only the chapters
the owner *flipped* away from their default, and the default is "the newest one is open".
A newly arriving chapter is open because it is newest, not because anything wrote it down.

**A run number appears only when there is more than one run.** The chapter knows how many
attempts its node has, so "Implement" and "Implement · run 2" are decided by the data, not by
whether `attempt` happens to be zero. AC-937's requirement that the attempt be identifiable
is met by the node's own detail in the rail, which lists every run.

**The rail is a list, not a diagram.** A vertical list of the pinned nodes fits a 20rem
column at any pipeline length, needs no layout pass, no pan/zoom, and no new dependency, and
it degrades to a phone by collapsing into one disclosure. It gives up exactly one thing a
diagram would give: the shape of the loop, redirect, and rework edges. That is the remaining
substance of `dag-visualization`, and this change deliberately leaves it there rather than
half-drawing it.

**Model bindings are shown by exception.** The rail states the task's baseline binding once —
the binding most of its roles share — and marks only the nodes that depart from it. A task
left on its defaults says so once instead of nine times; an override is visible exactly where
it takes effect, which is what AC-948 asks for.

**Commits are rendered short and linked.** Seven characters, the full hash on `title`, and an
`https://host/owner/repo/commit/<sha>` link when the remote parses to a host whose web scheme
is known (github.com, gitlab.com). An unknown host gets the short hash as plain text — a
guessed URL that 404s is worse than no link.

**Layout: a fixed-height column at desktop width, page flow below it.** The thread scrolls
inside its own pane so the action zone above it and the composer below it stay put, which is
what makes it read as a chat rather than as a page that grows. The action zone is capped
(46vh at a gate, since deciding on the gate is then the whole screen; 34vh otherwise) and
scrolls internally, so a tall gate panel can never squeeze the thread to nothing. Below
`xl` the whole page scrolls normally and the rail collapses into a disclosure above the
thread.

## Risks / Trade-offs

- **A chapter can be mis-attributed when the event window has scrolled past the transition
  that would have named the state.** Mitigated by reading the opening state off the oldest
  event that still carries a `from`, and by falling back to the graph's entry node. The cost
  of being wrong is a chapter titled by the wrong node, not a lost entry.
- **Collapsed history hides things.** Deliberate: the counts, duration, tokens, cost, and
  commit stay on the collapsed line, so the summary is informative enough to decide whether
  to open it. The owner's own toggles always win over the default.
- **Activity is capped at the last 8 lines per chapter**, with the count of what was dropped
  shown. A tool-heavy stage otherwise fills the thread with hundreds of one-line entries.
  Nothing is lost that the ledger does not still hold.
- **The fixed-height layout depends on viewport height.** Measured at 720/900/1000px tall:
  the thread pane keeps 137/256/322px respectively with a typical action zone. Below that the
  action zone's own cap keeps shrinking with the viewport, so the thread never reaches zero.

## Migration Plan

None — a rendering change in `apps/web`. No data migration, no API version bump.
