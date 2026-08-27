## Why

Phase 3 of the roadmap (docs/plan.md §14, "UI v1") owns the shape of the task view, and this
change has already rebuilt it once — the pinned rail, the chaptered thread, commits and attempts
rendered for a person rather than for a database. Then the owner read a real task on the deployed
screen, blocked on four kickoff-brief questions, and the rebuild turned out not to have gone far
enough. The full argument is `docs/design/task-screen-pass-3.md`; the specific failures:

- **The answer field had no question above it.** The action zone is its own scroll container
  sitting above a second scrolling thread. Scrolled a little, it showed a textarea and its
  buttons with the question itself pushed above its own fold. A scroll inside a scroll will do
  that every time.
- **The loudest thing on screen was already answered.** The resolved kickoff-gate question
  rendered in full, code references and all, while the four questions that needed an answer sat
  above it as truncated one-liners.
- **Two text inputs, and the wrong one was bigger.** With a question open, the composer at the
  foot is irrelevant, and it is the larger of the two.
- **Twelve pipeline rows, ten of them empty circles.** An unstarted node carries no information
  and was taking a column to say so.
- **The composer asks for two decisions before a word is typed** — `COMMENT / ASK GUIDE`, then
  `whole task ⌄` — and neither changes what any agent reads. Every comment is stored as
  `comment`, and the runner renders only `intervention`, `redirect`, and `rework`, so the
  destination the owner picks reaches nobody.

The first four are rendering. The fifth is not: it is a control that asks for a decision and
discards it, which is why this change stops being `apps/web`-only.

## What Changes

Three rules carry the redesign. **The column is the conversation, the rail is the machine** —
stage lifecycle, tool activity, commits, durations and tokens leave the thread and live behind
the pipeline node that produced them. **One input, at the foot, labelled by whatever is being
asked of you** — no mode to set, no target to pick, no second field. **The task's surfaces are
tabs on it**, in a column beside the content, so the header stays one row when a fourth surface
arrives.

- `operator-ui` REQ-919 is redefined before it ships: the thread carries only what a person said
  or was asked — questions, answers, comments, the guide's replies, gate outcomes. Five to
  fifteen lines over a whole task. The chapters go with the lifecycle entries that made them
  necessary.
- `operator-ui` gains REQ-920: one header row, and the task's thread, changed files and documents
  as addressable tabs in a column beside the content. The artifacts view and the files-changed
  view stop being screens.
- `operator-ui` gains REQ-921: one input, whose destination is chosen by the task's state and
  stated in words beside it — the running node, the open question, the gate, the restart, the
  next node, or plainly nowhere when the budget is spent.
- `operator-ui` REQ-914 is amended: the rail distinguishes four node states, not three — done,
  running, waiting on the owner, and **stopped**, which keeps its facts and states why instead of
  reverting to looking unstarted. Unstarted nodes fold into one line. Activating a node opens
  that node's run log — its runs with duration, cost, tokens, model and commit, and the activity
  each reported — and that log is where a comment is pinned to an older stage.
- `operator-ui` REQ-915 is amended: activity renders in its stage's run log, not in the thread.
  **This contradicts AC-940 as it stands**, which is why it is modified here rather than added
  beside it.
- `operator-ui` REQ-912 is amended: a resolved question stops being a card. Two clamped lines of
  the exchange and a way to open the whole of it.
- `operator-ui` REQ-906 is amended: what a comment addresses is decided by where it was written,
  not picked from a list of stages.
- `operator-ui` REQ-901 is amended: four screens, not five, and every task surface addressable.
- `operator-ui` REQ-911 is amended: the phone keeps the tabs, collapses the rail into one
  disclosure, and opens a run log as a full-height layer with its own way back.
- `task-surface` REQ-1008 is amended: where the task's state has a node the comment is addressed
  to, the API stores it as guidance targeted at that node instead of as commentary no agent
  reads.
- `agent-contracts` REQ-102 is amended: guidance stays pending until a run that received it is
  accepted. Today a run claims it and, if that run then fails, the retry does not re-claim it and
  the text is never rendered again — which is precisely the case the feature exists for.

### Pass 4 — the column is the step

Pass 3's first rule ("the column is the conversation, the rail is the machine") produced the
screen it deserved: a task one minute into its first node showed a single line — `Task launched
14:20` — in a column the width of the window, while what the node was doing, the control that
stops it, and the node's facts were stacked into the rail beside it. The freed space was not
used; it was vacated.

Pass 4 inverts the rule. **The thread is the step the owner is reading**: its runs' actions and
targets, the questions it raised, what was said to it, how it ended. **The rail is the switch** —
selecting a node changes what the thread carries rather than opening a log over it, so the run
log stops being a layer and becomes the thread itself. Everything an entry needs to find a home
is already in the timeline, so nothing is lost: an event belongs to the stage that produced it,
to the node it names, or to the node the task stood on when it happened.

The console loses its second strip. Stop moves out of the rail to sit beside Send in one row over
the field, and the sentence under the field — `Picked up by Planning on its next run · ⌘↵ to
send` — goes with it: the field's own prompt already says `Ask Planning something, or steer it…`.
Only a state that qualifies the destination keeps a line above the input.

Two regressions surface with it. The kickoff brief lost its call site in pass 3's redraw, leaving
an `Approve` button with nothing to read (REQ-913); it is restored in the gate's own chapter. And
pinning a comment to a stage, which pass 3 moved into the run log without wiring, is now what
typing while reading that stage does (REQ-906).

### Pass 5 — say each thing once, and only what changed

Pass 4 put the step in the column and the walk in the rail, and the owner read a real stopped task
on it. The screen was legible and still wrong in five ways, all of them variations on one fault:
it said things more than once, and it said the wrong things.

- **Twenty-five lines of `Reading` and `Searching`, and nothing else.** A stopped `Specify` filled
  its column with every file the run had looked at, each prefixed by seventy characters of
  workspace root. What a run *read* is how it got to what it *changed*; only the second is
  record. Reading now reports itself as one line that replaces itself while the run works — the
  spinner a chat has — and leaves nothing behind.
- **The step's state, four times.** `Stopped — Specify was stopped mid-run` in the header,
  `Specify · stopped` over the thread, `Specify … stopped` in the rail, `→ SPECIFY · stopped after
  2 attempts` over the input. Each place now says what the others do not.
- **The repository was the one real place on the screen and the only thing not a link.** It is a
  link, marked as a repository, with the task's pull request beside it — which the task detail
  endpoint did not carry and now does.
- **The rail was unreadable.** `opus-5 · high` with nothing saying what it qualified; `Pl…` where
  `Planning` did not fit beside a model badge; a commit hash in a column too narrow to read it;
  and seven of the ten nodes folded into `+4 more`. The rail is the walk: every node, in order,
  its state as a mark, and one fact about what it cost. Nodes that have not run are shown and not
  activatable — there is no step behind them to read.
- **The documents were a wall.** A gate rendered its brief and its decision log open and
  full-length, so a decision log reading `No decisions have been raised on this task yet` took a
  screenful and pushed the console under the fold. They are a shelf now: named, sized, one open at
  a time, clamped, with the whole of it a click away.

The thread also takes the shape of a transcript rather than a log table: `Edited(src/foo.ts)` for
a tool use, a sentence with a branch beneath it for what happened to the run, and no column of
clocks — a step is read as a sequence, and the width that column took is the width the paths need.

### Pass 6 — permanent deletion stays out of the thread

An archived or cancelled task can be finished in the product and still remain in the task index
forever. Permanent deletion is a rare administrative action, not part of reading or steering a
task, so it does not gain a place in the task header or beside the console. The task row exposes
an overflow menu; its last, separated action opens a confirmation that requires the task title
before SpecMate removes the task and its subordinate records.

- `operator-ui` gains REQ-1800: permanent deletion is reachable through a task row's overflow
  menu without becoming a standing control on the task, and the confirmation states its scope.
- `task-surface` gains REQ-1023: an archived or cancelled task can be deleted over REST after its
  workspace is released; an active or failed task is rejected without mutation.
- `persistence` REQ-310 already defines the subordinate records removed with a task, so this pass
  needs no schema change.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `operator-ui`: the thread, the tabs, the console and the rail's fourth state, as above.
  REQ-919 is redefined rather than superseded — it has not shipped, so no requirement enters the
  living spec in a shape the same change then deletes. The task index also gains the concealed,
  confirmed permanent-delete action in REQ-1800.
- `task-surface`: the feedback endpoint learns the one destination that reaches an agent, and
  REQ-1023 adds deletion of an archived or cancelled task.
- `agent-contracts`: confirmed guidance survives an unaccepted run.

## Impact

- `apps/web` — the task screen, its rail, its thread, its console, and the two screens that
  become tabs. Routes gain `/tasks/:id/files` and `/tasks/:id/docs`; `/tasks/:id/artifacts` and
  `/tasks/:id/diff` stop being screens. A task row gains a quiet overflow action and a typed-title
  confirmation for permanent deletion.
- `apps/api` — the feedback endpoint writes an intervention where there is a node to target, and
  emits an event either way so the text appears in the thread it was typed into. The task detail
  endpoint carries the task's pull request, which the header links. A delete endpoint releases
  the workspace and removes an archived or cancelled task.
- `apps/orchestrator` — a stage that ends any way but accepted releases the guidance it claimed.
- No schema change: the target and the claim are columns that already exist, and task-owned rows
  already cascade under persistence REQ-310.

## Non-goals

- **The Files tab keeps today's rendering.** It becomes a tab in this change; stacking every file
  as GitHub does, with per-file `Viewed` state and hunk expanders, is a later change and the one
  that amends REQ-916/AC-944. Selecting a file still renders its diff, so nothing here
  contradicts that requirement.
- **No Guide surface.** `Ask guide` leaves the console because it is a mode, and rule 2 forbids
  modes. The tab it becomes is a later change; until then the guide is reachable exactly where it
  is useful — a question's discussion (AC-933, AC-936).
- **No channel into a running agent.** A stage assembles its prompt once, at dispatch, so text
  typed while a node runs reaches that node's *next* run. The console says so; making it
  otherwise is a change to how stages are executed, not to how they are commanded.
- **No node-and-edge topology.** The rail lists the pinned pipeline and folds what has not run.
  Drawing the edges as a diagram was `dag-visualization`, which this change's second pass already
  hollowed out and which is now dropped.
- **No deletion of repository history.** Permanent deletion removes the task and its subordinate
  SpecMate records. It does not rewrite commits, branches, or pull requests held by the remote
  repository, and the confirmation says so.
- No redesign of the inbox, the new-task form, or Settings beyond the task row's overflow action.
