## Context

The task view reads five sources on every render: the task detail (`task`, `graph`, `stages`,
`spend`), the event window merged with the SSE stream, the conversation's messages and actions,
the decision rows, and the artifact index. This change's first pass grouped all of that into
per-stage chapters beside a pinned rail, which was an improvement over nine equal panels and
still produced the screen the owner complained about: a scroll container above a scroll
container, an answered question louder than four open ones, two text inputs, and ten empty
circles in the rail.

The diagnosis is that the first pass moved things around without deciding what the column is
*for*. Pass 3 decides: the column carries what people said, and everything the machine did lives
behind the node that did it. The rest follows from that one line.

One finding is not about rendering at all. `whole task ⌄` does set `feedback.stageId`, the role,
the provider, and a `nodeKey` on the emitted event — the control is not inert. What is inert is
the consequence: every comment is stored as `comment`, and the ledger renders only
`intervention`, `redirect`, and `rework`. The owner picks a destination and no agent ever reads
the text. That is why this change reaches past `apps/web`.

## Goals / Non-Goals

**Goals:**
- The thread is legible in one pass: five to fifteen lines over a whole task, and the newest
  thing that needs a person is the loudest thing on the screen.
- Every fact has exactly one place. A count on a tab is not also in the rail; a duration on a
  node is not also on a thread entry.
- One input, whose destination the owner reads rather than chooses — and which actually reaches
  an agent.
- What the interface claims is what the system does, including the parts that are unflattering:
  text typed at a running stage is read on its *next* run.
- Permanent deletion is discoverable when managing a finished task without becoming a standing
  action while that task is being read.

**Non-Goals:**
- The GitHub-shaped diff, a Guide surface, a channel into a live agent, a topology diagram (see
  proposal Non-goals).
- No new read. The rail, the run log, the thread and the tab counts are all derived from what
  `task-surface` REQ-1002/AC-1004 already returns and from the event stream that already drives
  the timeline.
- Deleting a task does not erase or rewrite repository history or a pull request on the remote.

## Decisions

**The thread is a filter, not a window.** Nothing ages out and nothing is paged: at five to
fifteen entries there is nothing to page. What keeps it that size is the admission rule — an
entry exists only if a person wrote it or was asked for it — not a cap on length. This matters
for the empty state, which is why there is not one: a task ten seconds old has one line in the
thread and one in the rail, and that is the right amount of screen for what is known about it.

**A stage's record moves behind its node, and the run log is a layer, not a route.** Everything
the thread used to carry inline — start, tool activity, questions raised, commit, acceptance,
with duration, cost, tokens and model in the header — opens over the column when a node is
activated. It is not a route, because it is a detail of the surface you are already on, and
routing it would put a back button between the owner and the thread they were reading. On a
phone it becomes full-height with its own way back, which is the same decision under a different
constraint.

**The rail needs a fourth state, and it is the one the pipeline actually produces.** Done,
running, and waiting on you are the states the first pass drew. The engine also produces
stopped: a failed attempt, a node at `stageAttemptCap`, a stage the sweeper found orphaned, a
task paused on an exhausted budget. Drawn as three states, a stopped node reverts to looking
unstarted, which is exactly the mush this pass removes. It keeps its facts and states the reason
in the slot the duration would occupy.

**The destination is derived, never chosen.** The console reads the task's state and states
where the text goes. The tempting escape hatch — a quiet `send somewhere else` beside the
destination line — is not kept, because a link that retargets can only open a list of targets,
which is the removed dropdown in a quieter costume. When the default is wrong the owner types
where the target already is: `Comment` inside that stage's run log. You never pick a target from
a list; you type into the thing.

**`Ask guide` leaves the console.** It is a mode set before typing, which is what rule 2 forbids,
and drawing it as a link rather than a toggle hides that instead of fixing it. What it costs is
smaller than it looks: the guide's reach into a running task is a set of actions it *proposes*
and the owner then confirms, and the two that bear on a running task — instruct the next run,
restart a stage — are what the console now does directly, with no model call in between. Until a
Guide surface exists the guide keeps the entry point it already has, a question's `Discuss`
(AC-933, AC-936).

**Guidance is released when a run ends unaccepted.** The engine claims every unconsumed
intervention whose target names the starting node, stamping `consumedByStageId`; the runner
renders an intervention only while the stage that claimed it is still running. Put together,
guidance is stamped when the node starts, and if that run fails the retry inserts a fresh stage
row, does not re-claim the stamped one, and the stage holding it is no longer running — so the
text is gone, unread, with no error anywhere. The fix is to clear the stamp in the same
transaction that already records a stage's end when that end is not acceptance. The alternative —
never stamp until a run is accepted — keeps exactly one claim per run but leaves a double-read
window when a run is accepted after a partial failure, and moves the claim away from the moment
the node starts, which is where the engine's own logic sits. The accepted cost of the chosen fix
is stated rather than discovered: an intervention stays re-readable until some run carrying it is
accepted.

**The console cannot promise more than dispatch delivers.** `executor.ts` loads the ledger once
per stage, before the provider starts. The prompt is sealed at dispatch and there is no channel
into a running agent at any layer. So the destination line says "picked up by Implement on its
next run", and the specification says the same. An interface that overstates what it does is how
the inert dropdown got built in the first place.

**Tabs are routes; the navigation is a column, not a header row.** The first draft put the tabs
in the header, and it works for three. It stops working at four, and there is a fourth — the
guide needs somewhere to live, and a header that grows a row per surface is the four-row header
this pass is deleting. A column grows downward for free. Routing them keeps REQ-901's
addressability intact and makes `/tasks/:id/files` and `/tasks/:id/docs` linkable; the old
`/tasks/:id/artifacts` and `/tasks/:id/diff` redirect rather than 404, since the inbox and older
links point at them.

**The header's two ambiguous slots get rules.** The repository slot says what the *current
surface* is about — `owner/repo · base` on the thread and the documents, `base…branch · N
commits` on the files — one fact per surface, never both. The trailing dot is the event stream,
not the task: phosphor while connected, muted while reconnecting, and labelled, because on a task
waiting for the owner the state is amber while the stream is perfectly healthy, and the two must
not read as one claim. That is also why it sits at the far end of the row rather than beside the
state sentence.

**Permanent deletion belongs to the task row, not the task.** The task header is shared by every
surface and exists to say what the task is, while the console exists to act on the work. Neither
is the place for removing the record itself. The task index is where the record is found and
where it disappears, so an archived or cancelled row owns an overflow control with the delete
action last and separated. On pointer devices the control can stay quiet until hover, focus, or
selection; keyboard and touch users still get an explicit reachable trigger. The trigger is a
sibling of the row's navigation link rather than a control nested inside a link, so opening the
menu never also navigates to the task.

**The irreversible verb has two locks.** State is the first: only archived and cancelled tasks
qualify. A failed task remains restartable and must be cancelled before deletion, so the delete
endpoint cannot race a recovery that still has meaning. Exact-title confirmation is the second:
the dialog names what SpecMate removes, names the repository history it leaves alone, and does
not enable its destructive verb until the title matches. Deleting the task currently open returns
to the inbox before invalidating the task reads, so no deleted detail is left as the current
screen.

**Release precedes deletion.** Archived and cancelled workspaces should already be released, and
release is idempotent under REQ-710; repeating it at the delete boundary closes the gap left by an
earlier cleanup failure. The database row is removed only after that succeeds, at which point
REQ-310 supplies the existing cascade. This keeps filesystem cleanup from needing a task record
that has already gone and keeps the change schema-free.

**What the first pass built is kept.** `task-thread.ts` keeps the event vocabulary and the
placement rules but stops grouping into chapters; `task-pipeline.ts` keeps `buildPipelineNodes`
and the baseline-binding rule and gains the fourth state; `repo-link.ts` and `commit-ref.tsx` are
unchanged — AC-954 and AC-955 are already satisfied and stay satisfied.

## Risks / Trade-offs

- **A filtered thread can hide something the owner wanted.** Mitigated by the rail: every entry
  the filter drops is behind the node that produced it, one click away, and the node states that
  it ran. What is genuinely lost is the ability to read the whole task as one linear log — which
  is what the ledger and the event stream are for, and neither is being changed.
- **The derived destination will be wrong sometimes.** Two nodes' worth of ambiguity, mostly
  around a task between stages. Mitigated by stating the destination in words before the owner
  sends, and by the run log being a place to type when the default is wrong. The failure mode is
  a comment reaching the next node instead of the last one — visible, and recoverable by typing
  again in the run log.
- **Clearing the claim makes guidance re-readable.** An intervention that no accepted run ever
  carries is re-read by every attempt at that node. Bounded in practice by the attempt cap; the
  alternative loses the text entirely, which is worse than reading it twice.
- **The two contradicted requirements are contradicted on purpose.** REQ-915/AC-940 says activity
  renders in the timeline and this change moves it behind a node. Modified here rather than added
  beside, so the living spec never asserts both shapes.
- **Deferring the diff redraw leaves the Files tab looking unlike its neighbours** — a
  list-detail panel inside a shell built for stacked cards. Accepted: the tab shell is what
  collapses the header and de-duplicates the rail, and it is worth having before the diff work.
- **The overflow control is intentionally quiet and therefore easier to miss.** Mitigated by
  keeping it keyboard- and touch-reachable and by using the task row, the place an owner already
  scans when managing old work. Permanent deletion benefits from a little discovery cost.
- **Workspace release can succeed while the later database deletion fails.** The surviving task
  is already archived or cancelled, so it needs no working tree and remains safe to retry; the
  reverse order could strand a working tree with no task identity and is worse.

## Migration Plan

None for data. `/tasks/:id/artifacts` and `/tasks/:id/diff` become redirects to
`/tasks/:id/docs` and `/tasks/:id/files`; `/tasks/:id/artifacts/:artifactId` keeps working, since
REQ-901 requires a single artifact to stay addressable. The claim fix is an `UPDATE` on a column
that already exists, applied to rows only as stages end, so nothing needs backfilling: an
intervention stranded by a run that failed before this change is picked up by the next attempt at
its node the first time that node ends a run unaccepted. Permanent deletion needs no migration:
REQ-310's foreign-key cascade is already present, and existing archived and cancelled tasks become
eligible as soon as the endpoint and client action ship.
