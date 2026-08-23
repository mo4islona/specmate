# Task screen — pass 3

Notes, not a spec. The mockup is [`task-screen-pass-3.html`](./task-screen-pass-3.html) — open it in a
browser at desktop width. Seven artboards: the thread in three states, Files, Docs, a stopped task,
and the console on its own. Everything below is what the mockup is arguing for and what it costs.

Specs come after, but not blind. Two of the arguments below contradict requirements that are already
live and already shipped, so the collisions are listed at the end rather than discovered later.

## The complaint

Two passes in, the task screen still reads as mush. Looking at a real one, blocked on four
kickoff-brief questions, here is what is actually wrong.

**The answer field had no question above it.** The action zone is its own scroll container —
`task-screen.tsx:485-488` picks one of `22vh / 62vh / 34vh` by state — sitting above a second
scrolling thread. Scrolled a little, it showed a textarea, an ANSWER button and DISMISS/DISCUSS, with
the question itself pushed above its own fold. A scroll inside a scroll will do that every time; it
was not bad luck.

**The loudest thing on screen was already answered.** The kickoff-gate question rendered in full, code
references and all, taking a third of the column — while the four questions that actually needed an
answer sat above it as truncated one-liners. History shouting over the live ask.

**Two text inputs, and the wrong one was bigger.** With a question open, the composer at the bottom is
irrelevant, but it is larger and closer to where the eye lands than the field you are supposed to
type in.

**Twelve pipeline rows, ten of them empty circles.** Unstarted nodes carry no information. They were
occupying the whole right column to say so.

## Three rules

1. **The column is the conversation, the rail is the machine.** Stage lifecycle, tool calls, commits,
   durations and tokens leave the feed. They live behind the pipeline node they belong to.
2. **One input, at the bottom, labelled by whatever is being asked of you.** Never two. Never a mode
   you set before typing.
3. **Files and Docs are tabs on the task, not separate pages** — and the tabs live in a nav column
   down the left, not on the header row. So the rail stops carrying a second copy of them, and the
   header stays one row when a fourth tab arrives.

## The feed

Only what a person said or was asked: questions, your answers, your comments, the guide's replies,
gate outcomes. Over a whole task that is five to fifteen lines.

No chapter headers. No `Stage started` / `Stage accepted`. No `Reading foo.ts`. On the screen that
started this, the feed collapses from a chapter tree down to five lines.

An answered question stops looking like a question. No border, no `QUESTION` label, no
`ANSWERED BY OWNER` footer — two lines of dialogue, clamped, with a link to the whole thing. Right now
`DecisionCard` renders history in the same box as the live ask and only the colour differs, which is
not enough of a difference.

The feed scrolls; it does not window. Artboard 3 is a later task scrolled to its end, not a feed that
dropped its beginning — the launch line and the kickoff-gate exchange are still above it. Nothing
ages out, because at five to fifteen lines nothing needs to.

A task ten seconds old therefore has one line in the feed and one line in the rail, and that is the
right amount of screen for what is known about it. The empty state is not a special case to design;
it is what these rules already produce.

## Where the stages went

Clicking a node in the rail opens that stage's run log over the column: start, tool calls, questions
raised, commit, accepted — with duration, cost, tokens and model in the header. Everything the thread
used to carry inline, in one place, one click away, and out of the way until asked for.

The rail itself shows what happened, not what might. Done and current nodes carry their facts; the
unstarted ones fold into a single line (`→ Research, Spec review, Spec gate, +6 more`).

It also has to show what went wrong, which the mockup under-draws. The pipeline produces four states
the rail must distinguish, not three: done, running, waiting on you, and **stopped** — a failed
attempt, a node that hit `stageAttemptCap`, a stage the sweeper found orphaned, a task paused on an
exhausted budget. A stopped node keeps its facts like a done one and states the reason in the same
slot the duration would occupy (`attempt 3 · cap reached`), because a node that silently reverts to
looking unstarted is the mush this pass is removing.

## The console

This is the part with a real finding behind it.

**The `whole task ⌄` select pins the comment, and the pin reaches nobody.** `apps/api/src/app.ts:894-935`
uses `input.stageId` to set `feedback.stageId`, `role` and `provider`, and to put `nodeKey` into the
`feedback.comment` event — which is exactly what makes `operator-ui` AC-912 pass. So the control is not
inert: the timeline really does record which stage you meant. What is inert is the consequence.
`packages/runner/src/ledger.ts:83` reads `intervention | redirect | rework`, every comment is written
`kind: 'comment'`, and so no agent will ever see the text whatever you picked. The form asks for a
decision that changes a label and nothing else — which is most of why it feels unintuitive.

Meanwhile the intervention path is built end to end and almost nothing uses it:

- `apps/orchestrator/src/engine.ts:717-736` — when a node starts, the engine claims every unconsumed
  `intervention` whose `target->>'nodeKey'` matches, stamping `consumedByStageId`.
- `packages/runner/src/ledger.ts:190-200` — the runner renders those into the prompt under
  `## Confirmed interventions`, ahead of gate comments, so guidance survives truncation.
- `apps/orchestrator/src/engine.ts:2162` — and there is already one writer. Restarting an interrupted
  stage with guidance writes `kind: 'intervention'` with `target: { graphId, nodeKey, stageId, attempt }`,
  reachable as `POST /tasks/:id/stages/restart` (`apps/api/src/app.ts:880`).

So the target shape is settled and there is a call site to copy. What is missing is a writer for the
ordinary case: a node that is running, or next up, with nothing interrupted.

So the console becomes: **no toggle, no scope select.** The task's state picks the destination, and
one line under the field states it.

| State | The field is | Where it goes |
| --- | --- | --- |
| A stage is running | a message to that stage | picked up on that node's next run |
| A question is open | the answer | unblocks the asking stage |
| At a gate | the comment | with Approve / Rework / Redirect as the verbs |
| A stage was interrupted | guidance for the restart | into the restart, which already carries it |
| Idle, more to run | a message to the next node | picked up when that node starts |
| Paused on an exhausted budget | nothing worth sending | the field is disabled and says to raise the cap |
| Finished or archived | a note on the record | nowhere, and the line says so |

The last four rows are the ones the first draft of this document left out, and the interrupted row is
the important one: today it is the only state in which text an owner types reaches an agent at all.
The console should route into that existing path rather than grow a parallel one beside it.

Pinning to an older stage is not a dropdown. You type where the target already is: `Comment` inside
that stage's run log, `💬` on a file in the Files tab. You never pick a target from a list; you type
into the thing.

**`send somewhere else` goes.** The first draft kept it as a quiet link beside the destination line,
on the grounds that the default is already right and the escape hatch costs nothing. It costs the
rule: a link that retargets can only open a list of targets, which is the dropdown again in a
quieter costume. Either it opens that list and the paragraph above is false, or it opens nothing and
it is the inert control this section exists to delete. The default is right; when it is not, you go
type where the target is.

**`Ask guide` leaves the console entirely.** It is a mode you set before typing —
`ComposerMode = 'comment' | 'conversation'` in `task-composer.tsx:7` — which is precisely what rule 2
forbids, and redrawing it as a link with an arrow hides that rather than fixing it. The guide gets
its own tab in a later pass, beside Thread, Files and Docs, where a conversation with its own history
has room to be one. Not part of this pass.

What that costs is smaller than it looks. The guide's reach into the pipeline is a set of actions it
*proposes* and the owner then confirms (`packages/core/src/conversations.ts:20-28`), and the two that
bear on a running task — `instruct_next_run` and `restart_stage` — are exactly what the console now
does itself, directly, with no model call in between. Answering, approving, reworking and redirecting
all have their own verbs in the states above. Until the tab lands the guide keeps the entry point it
already has: `Discuss` on an open question, which is the same conversation with that question as its
subject (AC-933, AC-936).

### What "ask the current stage directly" actually costs

Worth being blunt, because the wording in the mockup depends on it.

**UI only — free.** Drop the toggle and the select. Pure rendering, nothing server-side. But a comment
still reaches no agent, so the console must not claim otherwise.

**Make the text reach an agent — about twenty lines, plus a defect to fix first.** Teach the feedback
endpoint to write `kind: 'intervention'` with `target: { nodeKey }`; `restartInterruptedStage` shows
the shape. The engine and the runner do the rest — but not reliably, and the console cannot promise
more than the current claim-and-read pair delivers.

`ledger.ts:102` renders an intervention only while the stage that claimed it is still `running`, and
`engine.ts:729-736` claims only rows whose `consumedByStageId is null`. Put those together: guidance
is stamped when the node starts, and if that run then fails, the retry inserts a fresh stage row, does
not re-claim the already-stamped one, and the stage holding it is no longer `running`. The text is
gone — not read by the retry, not shown again, no error anywhere. That is precisely the case the
feature exists for: steering a stage that keeps failing.

So the honest cost is the writer plus one of two small fixes — don't stamp until the run is accepted,
or clear `consumedByStageId` when a stage ends any way but accepted. Which one is an open question
below; that the console's wording depends on the answer is not.

**The text has to come back into the feed.** Rule 1 says the column is what a person said, and a typed
intervention is a person saying something. But the comment path emits `feedback.comment` and the
restart path emits `stage.restart_confirmed`; a new writer with neither emits nothing, and the text
disappears from the thread it was typed into. That is part of the twenty lines that is not in the
twenty lines.

**Reach a live agent mid-run — its own change.** `packages/runner/src/executor.ts:157-163` loads the
ledger exactly once per stage, before the provider starts. The prompt is sealed at dispatch; there is
no channel into a running agent at any layer. Getting one means either re-reading pending
interventions between rounds, or steering at the provider-session level. Not a UI change.

The mockup says "picked up by Implement on its next run" for exactly this reason. An interface that
overstates what it does is how we got the inert dropdown.

## The header

One row instead of four. Title, state as a sentence, repo, stream — and nothing else:

```
Launch work  ●Waiting on you — 4 questions from the kickoff brief   mo4islona/specmate · main      ● STREAM
```

`BLOCKED` and `HARNESS GAP: PARTIAL` were two chips that had to be decoded. "Waiting on you — 4
questions from the kickoff brief" is the same information, already read. It reads the same on every
tab; the sentence is about the task, not about what you are looking at.

Two slots in that row need their rules stated, because both are easy to redraw wrongly.

**The repo slot says what the current tab is about.** `owner/repo · base` on Thread and Docs, where the
subject is the task; `base…branch · N commits` on Files, where the subject is the comparison. One
fact per tab, never both, and never a third copy of either inside the tab.

**The trailing dot is the event stream, not the task.** Phosphor while the stream is connected, muted
while it is reconnecting, and labelled `STREAM` so it is not read as a status light for the work. It
sits at the far end of the row rather than beside the state sentence for exactly that reason: on a
task waiting for you the state is amber and the stream is still green, and the two must not read as
one claim.

## The nav column

The tabs are not on the header row. They are a column down the left of the content, above the fold,
in the same place on every tab.

The first draft put them in the header, and it worked for three. It stops working the moment there
is a fourth, which there is: the guide needs somewhere to live, and a header row that grows a tab
every time the task gains a surface is a header row that will be four rows again within a pass. A
column grows downward for free.

It also gets the reading order right. The header answers *what is this task and how is it doing*; the
left column answers *what am I looking at*; the right rail answers *what is the machine doing*. Three
questions, three places, and the middle is the answer to none of them — it is the thing itself.

```
Launch work   ●Waiting on you — 4 questions        repo · main        ● STREAM
────────────────────────────────────────────────────────────────────────────────
 THREAD  │                                            │  Pipeline
 FILES 12│   the conversation                         │   Planning     5m 21s
 DOCS  5 │                                            │   Kickoff …    1m 36s
 ────────│                                            │  ●Kickoff gate waiting
 GUIDE   │   ┌──────────────────────────────────┐     │  → Research, +6 more
   soon  │   │  the one input                   │     │
         │   └──────────────────────────────────┘     │  Spend
```

`Guide` is drawn now and greyed as `soon`, because knowing where a thing will land is most of what
stops it from landing badly. Files drops the pipeline rail; the nav column stays on every tab.

Below `62rem` the column becomes a row above the content and keeps its counts.

## Files

`/tasks/:id/artifacts` and `/tasks/:id/diff` stop being separate screens with their own big headers
and back-links. They are tabs. The rail loses its artifact list and its `files changed →` link
(`task-rail.tsx:51-90`) — the counts live on the tabs now, and nothing is stated twice.

The Files tab takes the GitHub shape, deliberately and fairly literally, because that is where the
muscle memory is:

- file tree on the left with a filter box and per-file `+N −N`
- **all files stacked** on the right, not one at a time — today it is a `ListDetailPanel`
- per-file header: collapse chevron, path, copy-path, `+N −N` with the five-block bar, comment, and a
  `Viewed` checkbox
- `3 / 12 viewed` with a progress bar in the toolbar
- two line-number gutters, a sign column, coloured line backgrounds, `@@` hunk headers with `···`
  expanders
- a Unified/Split toggle

Syntax highlighting stays inside the existing palette: keywords amber, strings phosphor, types cyan,
comments muted. No new colours, no highlighting dependency needed for this to read right.

Three consequences to plan for.

**Stacking every file means N diff requests** where the API serves one path at a time — so expand the
first few and lazy-load the rest on expand, which is what GitHub does anyway.

**`Viewed` needs a home, and it is not `localStorage`.** GitHub keys it per user, per file, per commit,
and clears it when the file changes underneath you. The same rule here means storing it against the
task's current `HEAD`, so a newly accepted commit resets the ticks on the files it touched and leaves
the rest alone. A counter that survives the diff changing is worse than no counter — `3 / 12 viewed`
is a claim about a specific diff.

**The contradiction is with the spec, not with a change.** `code-diff-view` shipped in `44c3b51` and is
archived as `openspec/changes/archive/2026-08-19-code-diff-view`; it is not in flight and cannot be
amended. What a stacked view actually contradicts is the living requirement it left behind — REQ-916's
AC-944, "selecting a file SHALL render its unified diff". The split toggle contradicts nothing: that
change's own non-goals call a nicer rendering mode "a UI-only follow-up, not a spec change". See the
table at the end.

## Docs

Same two-pane shape as Files: list on the left grouped by kind, document on the right. A `Diff ⌄`
control sits in the document header as the hook for `artifact-diff-view` — inert until that change
lands.

## Two things the rules leave open, stated so they are not invented twice

**Phones.** REQ-911 is live spec, and rules 1 and 3 both assume a rail and a tab bar. Below `62rem` the
mockup simply stacks the rail under the console, which puts the pipeline below the input and lets a
node's run log replace a feed you have just scrolled through. Intended instead: the tab bar stays,
because it is routing and it is how you leave the thread; the rail collapses into the header's state
sentence plus one `Pipeline ⌄` disclosure; a run log opens as a full-height layer with its own back.

**The mockup is spans; the screen is not.** The artboards render buttons as `<span class="btn">`, tabs
as `<a href="#n">`, `Viewed` as a `<span class="box">` and the pager as `<b>`. That is mockup shorthand
and nothing else. Real: tabs are routes, so `/tasks/:id`, `/tasks/:id/files` and `/tasks/:id/docs`
stay deep-linkable and REQ-901's addressability survives the collapse; the console is a form with a
labelled textarea; `Viewed` is a checkbox; the pager is a real control. The code being replaced
already carries `aria-pressed`, `aria-label="Pin comment to stage"` and a `<fieldset><legend>` — none
of that should be lost to a redraw.

## What this changes in the living spec

Pass 3 is not additive. Six live requirements move, and two of them it contradicts outright.

| Requirement | What pass 3 does to it |
| --- | --- |
| **REQ-901** — five screens, artifacts among them | Artifacts becomes a tab. Both the count and the enumeration change, and addressability has to be restated for tabs (`/tasks/:id/files`, `/tasks/:id/docs`, `/tasks/:id/artifacts/:artifactId`) |
| **REQ-906 / AC-912** — comment "optionally pinned to a stage selected from the task's stages" | The selection mechanism *is* the dropdown being removed. Reword to pin by where the owner typed, and restate what the timeline shows |
| **REQ-907** — the artifacts view renders documents | Same rendering, no longer its own screen |
| **REQ-912 / AC-923** — a resolved card is history | Pass 3 says a resolved question stops being a card at all: two clamped lines in the feed |
| **REQ-914** — the task view supports conversation *and* explicit intervention | The intervention half gets its first real writer. The conversation half loses its console entry: `Ask guide` goes, and until a Guide tab lands the guide is reachable only through a question's `Discuss` |
| **REQ-915 / AC-940** — activity events render "in the timeline" | **Contradiction.** Pass 3 moves them behind a rail node. This is the most recently shipped of the six (`archive/2026-08-18-live-run-activity`) |
| **REQ-916 / AC-944** — "selecting a file SHALL render its unified diff" | **Contradiction.** Every file stacks; nothing is selected |
| **REQ-919** — the chaptered thread (`task-screen-redesign`, unarchived) | Replaced, not amended. AC-953/956/957/958/959/960 go with it. It was drafted as REQ-918; `decision-floors` took that number on main while the branch sat open, so the delta renumbered before anything else |

The two contradictions have to be MODIFIED requirements in whatever change carries pass 3, not new
ones added beside them — otherwise the spec asserts both shapes at once.

## Effect on changes already in flight

- **`task-screen-redesign`** is implemented but not archived, and pass 3 removes the whole of REQ-919
  rather than refining it. **Settled:** the change is rewritten in place rather than merged and then
  superseded, so no requirement enters the living spec that the next change deletes wholesale. Its
  pass-2 code stays as the foundation pass 3 reshapes. The execution order is `docs/plan.md` §16.
- **`code-diff-view`** is archived and shipped, not in flight. Its Files-Changed shape is now REQ-916,
  and that is what pass 3 amends. Separately, `openspec/changes/code-diff-view/` is a stale untracked
  copy of the archived change — byte-identical except that every task box is unchecked — and reads as
  an unstarted change to anyone who opens it. **Deleted.**
- **`dag-visualization`** loses more ground. The rail summarising done-and-current and folding the
  rest is not a diagram, and pass 3 does not need one. **Dropped** — its untracked draft is gone,
  and Phase 3's React Flow DAG is marked superseded in `docs/plan.md` §14.

## Open questions

- Does the Files tab drop the pipeline rail? It does in the mockup, because the diff needs the width
  and the header already says where the task stands.
- Does the per-file `💬` post into the thread as feedback anchored to that path?
- Which fix for the lost-on-retry intervention: never stamp `consumedByStageId` until the run is
  accepted, or clear it whenever a stage ends unaccepted? The first keeps one claim per run and risks
  a double-read if a run is accepted after a partial failure; the second is a one-line update in the
  same transaction that already records the stage's end, but makes an intervention re-readable an
  unbounded number of times until some run finally accepts.
  **Settled: clear the stamp.** Guidance surviving the failed attempt it was typed for is the whole
  point of the feature; being read again by the retry is the behaviour, not the cost.
