## RENAMED Requirements

- FROM: `### Requirement: REQ-901 — Five screens, inbox first`
- TO: `### Requirement: REQ-901 — Four screens, inbox first`

## ADDED Requirements

### Requirement: REQ-919 — The task's thread is what people said

The task view's thread SHALL carry only what a person said or was asked of them: questions
raised for the owner, the owner's answers and comments, the guide's replies, and the outcome of
each gate. Stage lifecycle, tool activity, accepted commits, durations, token use, and cost MUST
NOT appear in the thread — they belong to the pipeline node that produced them, and are read
there (REQ-914). Every entry SHALL name who wrote it and when. A question the owner has already
resolved SHALL be rendered as its exchange in no more than two clamped lines with a control that
opens the whole of it, and MUST NOT be presented with the border, label, or resolution footer
that marks a question still open (REQ-912). The thread SHALL be one scrolling region: no part of
it, and nothing above it, SHALL scroll inside a region of its own. New entries SHALL appear
without a reload and MUST NOT move the view away from what the owner is reading. A task with one
thing to say SHALL show that one entry, with no placeholder and no empty state of its own.

#### Scenario: AC-953 — Reading history while the task runs

- **WHEN** an entry arrives while the owner is reading an earlier part of the thread
- **THEN** it SHALL be appended without moving the owner away from what they are reading

#### Scenario: AC-956 — A question is one thing on the screen

- **WHEN** a task has open questions and the owner opens it
- **THEN** each question SHALL be presented once, where it is answered, and SHALL NOT also appear as a thread entry

#### Scenario: AC-958 — An answered question stops looking like a question

- **WHEN** the owner reopens a task whose questions were answered
- **THEN** each SHALL read as at most two clamped lines of the exchange with a control that opens the whole of it, and SHALL NOT carry the presentation of an open question

#### Scenario: AC-959 — The machine's own record is not in the thread

- **WHEN** a stage starts, reports activity, and is accepted with a commit
- **THEN** the thread SHALL gain no entry for any of it, and that stage's node SHALL carry all of it

### Requirement: REQ-920 — The task is one page, and its surfaces are tabs

The task view SHALL present one header row and a navigation column beside its content. The
header SHALL carry the task's title, its state as a sentence stating what the task is doing or
what it needs from the owner, one line of repository context, and an indicator of the event
stream's own health, labelled so that it cannot be read as the state of the work. The header
SHALL read the same on every one of the task's surfaces. The navigation SHALL list those
surfaces — the thread, the changed files, and the documents — each carrying its count where one
is known, and SHALL mark the surface being shown. Every surface SHALL be addressable by URL and
open directly at that address. A surface that is planned but not built SHALL be listed and
plainly marked unavailable rather than omitted. No fact SHALL be stated in two places: a count
carried by a tab MUST NOT also be listed in the pipeline rail, and a surface MUST NOT restate
the repository context the header already carries. Below a narrow viewport the navigation SHALL
become a row above the content and keep its counts.

#### Scenario: AC-957 — Reading a document without losing the task

- **WHEN** the owner opens one of the task's documents
- **THEN** it SHALL render on the task, with the header, the navigation, and the task's state still visible

#### Scenario: AC-960 — The header says one thing per surface

- **WHEN** the owner moves between the task's surfaces
- **THEN** the header SHALL stay one row, and its repository line SHALL name what the surface being shown is about

#### Scenario: AC-961 — Deep link to a surface

- **WHEN** a task surface's URL is opened directly in a fresh browser
- **THEN** that surface SHALL load with the task's header and navigation, without walking through another surface first

### Requirement: REQ-921 — One input, and it names where the text goes

The task view SHALL offer exactly one text input, at the foot of the thread. The owner MUST NOT
be required to choose a mode or a target before typing: the task's own state SHALL determine
where the text goes, and the view SHALL state that destination in words beside the input, naming
what will receive the text and when it will be read. The view MUST NOT offer a control that
retargets the text to something the state did not choose. The destination SHALL be derived from
the task's state: while a node is running, the text is guidance for that node; while a question
is open, it is the answer to the question shown, which SHALL be presented directly above the
input with a way to move between questions when more than one is open; at a gate, it is the
gate's comment, offered beside the gate's own actions (REQ-905); while a stage stands interrupted
or stopped, it is guidance carried into the restart (REQ-914); when nothing is running and the
pipeline has more to do, it is guidance for the node that runs next. Where the destination is a
pipeline node, the text SHALL be recorded as guidance targeted at that node, and the view SHALL
state that it is read on that node's next run — it MUST NOT claim to reach a run already under
way. Whatever the destination, text the owner sent SHALL appear in the thread (REQ-919). Where
the task's state offers no destination — its budget is spent, or it has finished — the input
SHALL be presented as unavailable, SHALL state why, and SHALL offer the action that would
restore one rather than accepting text that reaches nobody.

#### Scenario: AC-962 — The destination is stated, not chosen

- **WHEN** the owner opens a task with a node running
- **THEN** one input SHALL be shown with a line naming that node as its destination, and the view SHALL offer no control for choosing a different one

#### Scenario: AC-963 — Typed guidance reaches the node

- **WHEN** the owner sends text while a node is running
- **THEN** it SHALL be recorded as guidance targeted at that node, appear in the thread, and be read by that node's next run

#### Scenario: AC-964 — An open question labels the input

- **WHEN** a task has an open question
- **THEN** the question SHALL be shown directly above the input, the input SHALL be labelled as its answer, and no second text input SHALL be present

#### Scenario: AC-965 — Nothing to send to

- **WHEN** the task is paused with its budget spent
- **THEN** the input SHALL be unavailable, SHALL state that nothing will run until the cap moves, and SHALL offer raising it

## MODIFIED Requirements

### Requirement: REQ-901 — Four screens, inbox first

The client SHALL provide four screens — the Attention Inbox, a task view, a new-task form, and a
Settings screen — with the inbox as the home screen. A task's documents and its changed files
SHALL be surfaces of the task view (REQ-920), not screens of their own. A task list SHALL be
reachable from every screen, grouped by status with tasks needing the human pinned first and
visually distinct. Every screen SHALL be addressable by URL, and so SHALL every task surface, so
a link to a task, to one of its surfaces, to a single artifact, or to the Settings screen can be
opened directly.

#### Scenario: AC-901 — Opening the app

- **WHEN** the owner opens the client's root URL
- **THEN** the Attention Inbox SHALL be shown, with the task list reachable without further navigation

#### Scenario: AC-902 — Deep link to a task

- **WHEN** a task view URL is opened directly in a fresh browser
- **THEN** that task's view SHALL load without walking through the inbox first

### Requirement: REQ-906 — Feedback from anywhere

The task view SHALL always offer a comment input — not only at gates — posting to the feedback
capture endpoint. What a comment addresses SHALL be decided by where the owner wrote it, never
by a target chosen from a list: text sent from the one input at the foot of the thread addresses
the destination that input names (REQ-921), and a comment written inside a stage's run log
addresses that stage. A posted comment SHALL appear in the thread without a reload. This input
SHALL be present and usable on a phone-sized viewport.

#### Scenario: AC-911 — Commenting mid-run

- **WHEN** the owner posts a comment while a stage is running
- **THEN** the comment SHALL be accepted, appear in the thread, and the run SHALL be unaffected

#### Scenario: AC-912 — Pinning a comment to a stage

- **WHEN** the owner comments from inside an earlier stage's run log
- **THEN** the stored comment SHALL address that stage, and the owner SHALL NOT have been asked to select it from a list

### Requirement: REQ-907 — Artifacts render as documents

The task's documents SHALL be one of its surfaces (REQ-920), listing the task's artifacts by
kind and rendering a selected artifact's markdown as a readable document — headings, lists,
tables, code blocks — not as raw text. An artifact updated by a later stage SHALL show its fresh
content when reopened. The number of documents SHALL be carried by that surface's own tab and
stated nowhere else.

#### Scenario: AC-913 — Reading a proposal

- **WHEN** the owner opens the task's proposal artifact
- **THEN** it SHALL render as formatted markdown

#### Scenario: AC-914 — Artifact updated between visits

- **WHEN** a stage rewrites an artifact and the owner reopens it
- **THEN** the rendered content SHALL be the updated version

### Requirement: REQ-911 — Usable from a phone

Every screen SHALL be usable on a phone-sized viewport: no horizontal scrolling of the page,
actions reachable, forms and the comment input operable. The owner being able to comment on
everything from the browser or phone is a contract, not an aspiration. On the task view the
navigation between its surfaces SHALL remain available at every width, since it is how the owner
leaves the thread; the pipeline rail SHALL collapse into a single disclosure rather than
displacing the thread; and a stage's run log SHALL open as a full-height layer carrying its own
way back.

#### Scenario: AC-920 — Approving from a phone

- **WHEN** the owner opens a parked task on a phone-sized viewport
- **THEN** the gate actions SHALL be visible and operable without horizontal scrolling

#### Scenario: AC-968 — The task view on a phone

- **WHEN** the owner opens a running task on a phone-sized viewport
- **THEN** its surfaces SHALL stay reachable, the pipeline SHALL be behind one disclosure, and opening a node's run log SHALL leave a way back to the thread

### Requirement: REQ-912 — Decisions are cards, not log lines

An open decision SHALL appear in the task view as a card visually distinct from ordinary thread
entries, rendering its question as markdown, offering its options as direct actions alongside a
free-text answer and an entry to its scoped discussion, and stating plainly when the task is
stopped on it. While the decision is open its card SHALL be presented where the owner acts —
directly above the one input (REQ-921) — rather than inside the task's history, and a decision
the task is stopped on SHALL be presented ahead of one that is merely open. The discussion SHALL
render as the decision's conversation rather than as unrelated task comments. Answering or
dismissing SHALL happen only through an explicit control. Once resolved, the decision SHALL stop
being a card: it SHALL take its place in the thread at the point it was raised, as its exchange
clamped to no more than two lines with a control that opens the whole of it (REQ-919), and SHALL
offer no resolution actions. Cards and discussion controls SHALL be operable on a phone-sized
viewport.

#### Scenario: AC-921 — A question arrives while watching

- **WHEN** a decision is raised on a task the owner has open
- **THEN** its card SHALL appear without a reload, presented with the task's other pending actions and marked as needing the owner

#### Scenario: AC-922 — Answering from the card

- **WHEN** the owner answers the last blocking decision from its card
- **THEN** the card SHALL show the answer and the view SHALL stop presenting the task as stopped, without a reload

#### Scenario: AC-923 — A resolved card is history

- **WHEN** a task with resolved decisions is reopened
- **THEN** each SHALL read in the thread as its question and outcome clamped to no more than two lines, with a control that opens the whole exchange and no resolution actions

#### Scenario: AC-924 — Answering from a phone

- **WHEN** a card with options is opened on a phone-sized viewport
- **THEN** its options and its answer input SHALL be reachable and operable without horizontal scrolling

#### Scenario: AC-933 — Discussing before answering

- **WHEN** the owner opens discussion from an unresolved decision card and asks a follow-up
- **THEN** the contextual response SHALL appear with the decision still marked unresolved and its resolution controls still available

#### Scenario: AC-934 — Proposed answer awaits confirmation

- **WHEN** the discussion proposes an answer
- **THEN** the card SHALL distinguish the proposal from the recorded outcome and require explicit confirmation before showing the decision as answered

### Requirement: REQ-914 — The task view supports conversation and explicit intervention

The task view SHALL present a conversation's ordered owner and assistant messages, response
progress and failure, the task state and commit each answer used, and any proposed action. An
action SHALL require a separate confirmation that names its target and effect. A conversation
SHALL be reachable from the question it is about; the one input at the foot of the thread MUST
NOT carry a mode that redirects text to a conversation instead of the destination it states
(REQ-921). Restarting a stage SHALL plainly state that uncommitted work from its interrupted
attempt was discarded. A direct `Stop current run` control SHALL be visible whenever a stage is
running, independently of conversation content; its confirmation SHALL name the stage and the
loss of uncommitted work, and its progress SHALL remain visible until the task is safely paused.
Restart SHALL be a separate control whose form SHALL accept optional guidance entered there or
selected from a conversation proposal, and confirmation SHALL show the exact instruction the
replacement will receive.

The task view SHALL render the pinned pipeline as a rail that stays in view while the thread
scrolls. The rail SHALL distinguish four node states — finished, running, waiting on the owner,
and stopped — and SHALL mark the node the task stands on together with its live `running`,
`stopping`, `paused`, or terminal state. A stopped node — one whose attempts are spent, whose run
was found orphaned, or whose task is paused with its budget exhausted — SHALL keep the facts a
finished node carries and SHALL state the reason it stopped in their place; it MUST NOT revert to
the presentation of a node that has not run. Nodes that have not run SHALL be summarised together
in a single line naming how many there are, rather than listed one by one. Activating a node
SHALL reveal, in place, that node's run log: each run with its status, duration, token use, cost,
model, and accepted commit; the activity that run reported (REQ-915); and a control to comment on
that run (REQ-906). For a stage node the run log SHALL name the role that runs it. A model binding
SHALL be named on a node only where it departs from the task's baseline binding, which the rail
SHALL state once. An attempt SHALL be numbered only where its node has run more than once. An
accepted commit SHALL be rendered in short form with its full value available, linked to the
commit wherever the repository's web address is derivable. The view MUST NOT present a running
attempt's uncommitted file edits as accepted changes; new code or artifact content becomes visible
only after the stage result and commit are accepted. The transcript, rail, run log, thread, input,
stop/restart, and confirmation controls SHALL be operable on a phone-sized viewport and update
from task events without reload.

#### Scenario: AC-929 — A follow-up retains context

- **WHEN** the owner asks a follow-up from the task view
- **THEN** it SHALL appear in the existing conversation and the response SHALL render beneath it without a manual refresh

#### Scenario: AC-930 — A proposal has no implicit effect

- **WHEN** the assistant proposes restarting an owner-interrupted stage
- **THEN** the task view SHALL show a distinct confirmation control and SHALL NOT present the proposal as already applied

#### Scenario: AC-931 — Stop consequence is visible

- **WHEN** the owner opens confirmation for `Stop current run`
- **THEN** the exact running stage, possible remaining cost, and loss of uncommitted work SHALL be visible before confirmation

#### Scenario: AC-932 — A stale confirmation recovers

- **WHEN** restart confirmation conflicts because the task is no longer paused at that interrupted stage
- **THEN** the view SHALL retain the conversation, refresh task state, and offer no claim that another stage was restarted

#### Scenario: AC-935 — The owner stops without waiting for chat

- **WHEN** a stage is running and no assistant response or proposal exists
- **THEN** the task view SHALL still let the owner stop that exact run, show stopping progress, and leave the cleaned task paused with a separate restart control

#### Scenario: AC-937 — The current pipeline position is explicit

- **WHEN** the owner opens a task with an active or paused attempt
- **THEN** the rail SHALL mark the current node with its state, and that node SHALL name its runs and its last accepted commit, without requiring the owner to infer them from the thread

#### Scenario: AC-938 — Activity is not a live file feed

- **WHEN** a running attempt changes files before its result is accepted
- **THEN** its node's run log SHALL show run activity but SHALL NOT show those edits as accepted changes, and a later accepted completion SHALL expose its commit and refreshed artifacts

#### Scenario: AC-954 — A first attempt is not numbered

- **WHEN** the owner opens a task whose current node has run exactly once
- **THEN** the view SHALL present that run without an attempt number, and SHALL number the runs as soon as the node runs again

#### Scenario: AC-955 — An accepted commit is legible

- **WHEN** a stage has accepted a commit and the task's repository is hosted where a commit URL is derivable
- **THEN** the view SHALL show the commit in short form, carry its full value, and link to that commit

#### Scenario: AC-966 — A node that stopped says why

- **WHEN** a node's attempts are spent and the task is stopped on it
- **THEN** the rail SHALL keep that node's facts and state the reason it stopped where a finished node states its duration, rather than presenting it as not yet run

#### Scenario: AC-967 — Going back to what a stage did

- **WHEN** the owner activates an earlier node in the rail
- **THEN** that node's run log SHALL open over the thread, carrying its runs, their spend, their activity, and a way to comment on the run

### Requirement: REQ-915 — The task view surfaces live stage activity, subordinate to accepted state

While a stage is running, the task view SHALL render its activity events in that stage's own run
log (REQ-914), each naming the recognized action and marked visibly as in-progress rather than
accepted. Activity MUST NOT appear in the thread, which carries only what a person said
(REQ-919); the rail SHALL show that the node is running, so the owner can find the activity
without being given it unasked. Once the stage's result is accepted, its activity events SHALL be
visually demoted — collapsed or removed — rather than left standing alongside the accepted
outcome. A stage with no activity events SHALL still show as running without implying that
nothing is happening; absence of activity events MUST NOT be presented as an error or stall.

#### Scenario: AC-940 — Activity appears while a stage runs

- **WHEN** a running stage's provider CLI reports a recognized action
- **THEN** it SHALL appear in that stage's run log marked as in-progress and without a reload, and the thread SHALL gain no entry for it

#### Scenario: AC-941 — Accepted result demotes prior activity

- **WHEN** a stage's result is accepted after it reported activity
- **THEN** the run log SHALL show the accepted outcome and SHALL NOT present that attempt's activity events as current

#### Scenario: AC-942 — No activity yet

- **WHEN** a stage is running and no activity has been reported
- **THEN** the rail SHALL still show it as running, without presenting the absence of activity as a failure
