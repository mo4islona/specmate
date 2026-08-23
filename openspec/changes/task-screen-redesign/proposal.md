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

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `operator-ui`: the thread, the tabs, the console and the rail's fourth state, as above.
  REQ-919 is redefined rather than superseded — it has not shipped, so no requirement enters the
  living spec in a shape the same change then deletes.
- `task-surface`: the feedback endpoint learns the one destination that reaches an agent.
- `agent-contracts`: confirmed guidance survives an unaccepted run.

## Impact

- `apps/web` — the task screen, its rail, its thread, its console, and the two screens that
  become tabs. Routes gain `/tasks/:id/files` and `/tasks/:id/docs`; `/tasks/:id/artifacts` and
  `/tasks/:id/diff` stop being screens.
- `apps/api` — the feedback endpoint writes an intervention where there is a node to target, and
  emits an event either way so the text appears in the thread it was typed into.
- `apps/orchestrator` — a stage that ends any way but accepted releases the guidance it claimed.
- No schema change: the target and the claim are columns that already exist.

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
- No redesign of the inbox, the new-task form, or Settings.
