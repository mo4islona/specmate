## RENAMED Requirements

- FROM: `### Requirement: REQ-901 — Five screens, inbox first`
- TO: `### Requirement: REQ-901 — Four screens, inbox first`

## ADDED Requirements

### Requirement: REQ-919 — The task's thread is the step's own history

The task view's thread SHALL read one pipeline step at a time, and SHALL carry that step's whole
record: what its runs did — each action and what it acted on — what it asked of the owner, what
the owner said to it, the guide's replies, and how the step ended. The step being read SHALL be
the one the task stands on, until the owner selects another in the rail (REQ-914); selecting
another SHALL replace what the thread carries with that step's record. Every entry SHALL belong
to exactly one step: an entry a stage produced belongs to that stage's node, an entry naming a
node belongs to that node, and everything else belongs to the step the task stood on when it
happened — so a task's whole history is reachable one step at a time and no entry is homeless.
The thread SHALL distinguish what a person said from what the machine did without splitting them
into two regions: a turn SHALL name who wrote it, a line of the machine's record SHALL name what
the run did, and the two SHALL share one column in the order they happened. A line SHALL read as
a transcript reads: one tool use as the verb and its object together — `Edited(src/foo.ts)` —
and anything that happened to the run as a sentence with its particulars on a branch beneath it.
A line MUST NOT reserve a column for its clock: a step is read as a sequence, and a column of
timestamps buys an ordering the order already gives, at the width the line needs for what it
names. The exact moment SHALL remain available on the entry and to a screen reader. A question
the owner has already
resolved SHALL be rendered as its exchange in no more than two clamped lines with a control that
opens the whole of it, and MUST NOT be presented with the border, label, or resolution footer
that marks a question still open (REQ-912). The thread SHALL be one scrolling region: no part of
it, and nothing above it, SHALL scroll inside a region of its own. New entries SHALL appear
without a reload and MUST NOT move the view away from what the owner is reading. A step SHALL end
with the documents its runs wrote, rendered in place rather than named and linked away; a gate,
whose own runs write nothing, SHALL end with the documents of the step it is judging, so that what
is being approved is on the screen doing the approving (REQ-907). Where the step being read is the
one the task stands on, its first document SHALL be open. A step with one
thing to say SHALL show that one entry, with no placeholder and no empty state of its own.

#### Scenario: AC-953 — Reading history while the task runs

- **WHEN** an entry arrives while the owner is reading an earlier part of the thread
- **THEN** it SHALL be appended without moving the owner away from what they are reading

#### Scenario: AC-956 — A question is one thing on the screen

- **WHEN** a task has open questions and the owner opens it
- **THEN** each question SHALL be presented once, where it is answered, and SHALL NOT also appear as a thread entry

#### Scenario: AC-958 — An answered question stops looking like a question

- **WHEN** the owner reopens a task whose questions were answered
- **THEN** each SHALL read as at most two clamped lines of the exchange with a control that opens the whole exchange, and SHALL NOT carry the presentation of an open question

#### Scenario: AC-959 — The machine's record is in the step that produced it

- **WHEN** a stage starts, reports activity, and is accepted with a commit
- **THEN** each of those SHALL read in that stage's step, and no other step's thread SHALL carry any of them

#### Scenario: AC-969 — A recovered failure is history of its own step

- **WHEN** one attempt at a node fails and a later attempt at the same node is accepted
- **THEN** both SHALL read in that node's own record, and reading any other step SHALL show neither

#### Scenario: AC-989 — A gate shows what it is asking about

- **WHEN** the owner opens a task parked at a gate
- **THEN** the document that gate is judging SHALL be rendered in the gate's own step, open, above the input that approves it

#### Scenario: AC-990 — Switching the step switches the thread

- **WHEN** the owner selects a finished node in the rail while another step is running
- **THEN** the thread SHALL read that node's record, headed by what that node is and what it spent, and SHALL return to following the task when the owner selects the step the task stands on

### Requirement: REQ-920 — The task is one page, and its surfaces are tabs

The task view SHALL present one header row and a navigation row directly beneath it. The
header SHALL carry the task's title, its state as a sentence stating what the task is doing or
what it needs from the owner, what qualifies that state, and an indicator of the event
stream's own health, labelled so that it cannot be read as the state of the work. One line of
repository context SHALL sit at the trailing end of the navigation row: the repository named as
its owner and name, the ref the surface reads it at, and — once the task has opened one — its
pull request named by number. The repository and the pull request SHALL be links to the places
they name wherever the remote's web address is derivable, and SHALL be marked as a repository and
a pull request rather than left as bare text; a remote whose web address cannot be derived SHALL
be named without a link rather than linked to a guess. The header
SHALL read the same on every one of the task's surfaces. The navigation SHALL list those
surfaces — the thread, the changed files, and the documents — each carrying its count where one
is known, and SHALL mark the surface being shown. It SHALL stay one row at every width,
scrolling sideways rather than wrapping the header into a second row, and MUST NOT take a
column of its own beside the content: the client already carries a task list down its left
edge, and two navigations for one screen is what this requirement exists to prevent. Every
surface SHALL be addressable by URL and
open directly at that address. A surface that is planned but not built SHALL be listed and
plainly marked unavailable rather than omitted. No fact SHALL be stated in two places: a count
carried by a tab MUST NOT also be listed in the pipeline rail, a surface MUST NOT restate
the repository context the header already carries, and what qualifies the state — a coverage
gap, the declared plan size, the tasks this one descends from — SHALL sit with the state rather
than in the rail, which carries the pipeline and the spend and nothing else.

#### Scenario: AC-957 — Reading a document without losing the task

- **WHEN** the owner opens one of the task's documents
- **THEN** it SHALL render on the task, with the header, the navigation, and the task's state still visible

#### Scenario: AC-960 — The header says one thing per surface

- **WHEN** the owner moves between the task's surfaces
- **THEN** the header SHALL stay one row, and its repository line SHALL name what the surface being shown is about

#### Scenario: AC-961 — Deep link to a surface

- **WHEN** a task surface's URL is opened directly in a fresh browser
- **THEN** that surface SHALL load with the task's header and navigation, without walking through another surface first

#### Scenario: AC-984 — The repository is somewhere to go

- **WHEN** the owner reads a task whose remote is on a host with a known web address, and which has opened a pull request
- **THEN** the repository SHALL be a link to it and the pull request SHALL be a link named by its number, both marked as what they are

### Requirement: REQ-921 — One input, one row of verbs, and it names where the text goes

The task view SHALL offer exactly one text input, at the foot of the thread. The owner MUST NOT
be required to choose a mode or a target before typing: the task's own state SHALL determine
where the text goes, and the input SHALL name that destination in its own prompt. The view MUST
NOT offer a control that retargets the text to something the state did not choose, and MUST NOT
restate the destination in a sentence beside a field that already names it, nor spell out the
keystroke that sends it. Where the state qualifies the destination — a discussion the owner is
inside, a cap that is spent, a stop whose uncommitted work is already gone, a gate's remaining
redirects — that qualification SHALL be stated in one line above the input, and nowhere else.
That line MUST NOT name the node when it is the step the thread is already headed by: the step's
head (REQ-914) has named it, and a console repeating it makes one fact the third statement of
itself on a screen that had already said it twice. Where the destination is not a step being read
— the guide, or plainly nowhere — it SHALL be named.
Every control the state offers — sending, stopping the run that is under way (REQ-914), a gate's
own verbs (REQ-905), dismissing or discussing an open question, and the state's quiet ways out —
SHALL sit in one row on the input's own surface, so that what acts and what types are one block
rather than a field with a separate strip of controls outside it. That row SHALL follow the
input, in the order a person works: they write, and then they decide what to do with what they
wrote. A control that opens something — a confirmation, a rework target — SHALL open over the
block rather than push the row it belongs to. The destination SHALL be derived from
the task's state: while a node is running, the text is guidance for that node; while a question
is open, it is the answer to the question shown, which SHALL be presented directly above the
input with a way to move between questions when more than one is open; at a gate, it is the
gate's comment; while a stage stands interrupted
or stopped, it is guidance carried into the restart (REQ-914); when nothing is running and the
pipeline has more to do, it is guidance for the node that runs next. A discussion the owner opened
from a question SHALL take the input for as long as it is open, with a control that closes it and
hands the input back — opening a discussion is an action on a specific question, not a mode set
before typing, and the owner MUST NOT be able to reach the guide any other way while no Guide
surface exists. Where the destination is a
pipeline node, the text SHALL be recorded as guidance targeted at that node, and the view MUST
NOT claim to reach a run already under way. Whatever the destination, text the owner sent SHALL
appear in the thread (REQ-919). Where
the task's state offers no destination — its budget is spent, or it has finished — the input
SHALL be presented as unavailable, SHALL state why, and SHALL offer the action that would
restore one rather than accepting text that reaches nobody.

#### Scenario: AC-962 — The destination is stated, not chosen

- **WHEN** the owner opens a task with a node running
- **THEN** one input SHALL be shown naming that node in its own prompt, with no sentence beneath it repeating the destination and no control for choosing a different one

#### Scenario: AC-985 — The console does not restate the step it stands in

- **WHEN** the owner reads the step of a stopped node, whose restart the console is offering
- **THEN** the line above the input SHALL carry what the head does not — that the uncommitted work is gone — without naming the node the head has already named

#### Scenario: AC-963 — Typed guidance reaches the node

- **WHEN** the owner sends text while a node is running
- **THEN** it SHALL be recorded as guidance targeted at that node, appear in the thread, and be read by that node's next run

#### Scenario: AC-964 — An open question labels the input

- **WHEN** a task has an open question
- **THEN** the question SHALL be shown directly above the input, the input SHALL be labelled as its answer, and no second text input SHALL be present

#### Scenario: AC-965 — Nothing to send to

- **WHEN** the task is paused with its budget spent
- **THEN** the input SHALL be unavailable, SHALL state that nothing will run until the cap moves, and SHALL offer raising it

#### Scenario: AC-970 — A discussion takes the input while it is open

- **WHEN** the owner opens the discussion on an unresolved question
- **THEN** the one input SHALL address that discussion, SHALL say so, and SHALL offer closing it to go back to answering

#### Scenario: AC-991 — Stopping and sending are one reach apart

- **WHEN** the owner opens a task with a node running
- **THEN** stopping that run and sending the text SHALL both be in the row directly above the input, and no control SHALL sit below it

### Requirement: REQ-1800 — Permanent deletion is available without becoming furniture

The task list SHALL make permanent deletion available only from an archived or cancelled task's
overflow menu. The destructive action MUST NOT appear in the task header, its navigation, its
thread, or as a standing button in the task row. The overflow control SHALL remain reachable by
keyboard and on a touch screen; a pointer interface MAY reveal it only while the row is hovered,
focused, or current. `Delete task permanently…` SHALL be the menu's last item and SHALL be
separated from non-destructive actions. An active or failed task MUST NOT offer permanent
deletion, because the former is still running and the latter remains restartable.

Selecting permanent deletion SHALL open a confirmation that names the task, states that the task
and its subordinate SpecMate records will be removed, and states that repository commits,
branches, and pull requests are not rewritten. The destructive confirmation SHALL remain
unavailable until the owner enters the task's title exactly. While deletion is in flight the
confirmation SHALL state that it is working and prevent a second request; a failure SHALL leave
the task and the confirmation in place with the reason. Success SHALL remove the row from the
task list, and deleting the task currently open SHALL return the owner to the inbox rather than
leave a route to a record that no longer exists.

#### Scenario: AC-1805 — Deletion is behind the terminal task's overflow menu

- **WHEN** the owner opens an archived or cancelled task row's overflow menu
- **THEN** `Delete task permanently…` SHALL appear as its last separated action, while no permanent-delete control appears in the task header or thread

#### Scenario: AC-1806 — A recoverable task cannot be deleted

- **WHEN** a task is active or failed
- **THEN** its task-row menu SHALL NOT offer permanent deletion

#### Scenario: AC-1807 — The title guards the irreversible action

- **WHEN** the owner opens the permanent-delete confirmation and has not entered the task's title exactly
- **THEN** the destructive confirmation SHALL remain unavailable and no delete request SHALL be made

#### Scenario: AC-1808 — Deleting the task being read leaves a valid screen

- **WHEN** permanent deletion succeeds for the task whose route is open
- **THEN** its row SHALL disappear and the owner SHALL be returned to the inbox

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
capture endpoint. What a comment addresses SHALL be decided by where the owner wrote it, never by
a target chosen from a list: text sent while the thread is following the task addresses the
destination the input names (REQ-921), and text sent while the owner is reading an older step's
record (REQ-919) is pinned to that step's run as commentary. Where the task's state is asking
something of the owner — a question, a gate, a stopped stage — that demand SHALL keep the input,
whichever step is being read, so that an answer cannot be pinned to a run by accident. A posted
comment SHALL appear in the thread without a reload. This input SHALL be present and usable on a
phone-sized viewport.

#### Scenario: AC-911 — Commenting mid-run

- **WHEN** the owner posts a comment while a stage is running
- **THEN** the comment SHALL be accepted, appear in the thread, and the run SHALL be unaffected

#### Scenario: AC-912 — Pinning a comment to a stage

- **WHEN** the owner comments while reading an earlier stage's record
- **THEN** the stored comment SHALL be pinned to that stage, the input SHALL have said so before it was sent, and the owner SHALL NOT have been asked to select the stage from a list

### Requirement: REQ-907 — Artifacts render as documents

The task's documents SHALL be one of its surfaces (REQ-920), listing the task's artifacts by
kind and rendering a selected artifact's markdown as a readable document — headings, lists,
tables, code blocks — not as raw text. A document SHALL also be readable in the step whose runs
wrote it (REQ-919), without leaving the thread: the surface is the index of everything the task
holds, and the step is where its own output is read.

In a step, the documents SHALL be presented as a shelf and not a stack: each named by its kind
and its file, each stating how much of it there is — including that there is none — and at most
one of them open at a time. An open document SHALL be clamped to a readable height with a control
that opens the whole of it in place, and a way to open it on the documents surface. It MUST NOT
expand inside a scrolling region of its own, because the thread is one scrolling region (REQ-919)
and a box that scrolls within it is a fold. Rendering every document open and full-length is what
put a decision log saying nothing at the same size as the proposal it followed, and pushed the
console under the fold to do it.

An artifact updated by a later stage SHALL show its fresh content when reopened. The number of
documents SHALL be carried by that surface's own tab and stated nowhere else.

#### Scenario: AC-913 — Reading a proposal

- **WHEN** the owner opens the task's proposal artifact
- **THEN** it SHALL render as formatted markdown

#### Scenario: AC-914 — Artifact updated between visits

- **WHEN** a stage rewrites an artifact and the owner reopens it
- **THEN** the rendered content SHALL be the updated version

#### Scenario: AC-986 — A step's documents are a shelf

- **WHEN** a step wrote a long proposal and a decision log with nothing in it
- **THEN** both SHALL be named with their size, the empty one SHALL say so without being opened, and at most one SHALL be open — clamped, with a control that opens the whole of it

### Requirement: REQ-911 — Usable from a phone

Every screen SHALL be usable on a phone-sized viewport: no horizontal scrolling of the page,
actions reachable, forms and the comment input operable. The owner being able to comment on
everything from the browser or phone is a contract, not an aspiration. On the task view the
navigation between its surfaces SHALL remain available at every width, since it is how the owner
leaves the thread; and the pipeline rail SHALL collapse into a single disclosure rather than
displacing the thread, selecting a step in it SHALL change the thread beneath it (REQ-919), so
that nothing opens as a layer the owner then has to find their way back out of.

#### Scenario: AC-920 — Approving from a phone

- **WHEN** the owner opens a parked task on a phone-sized viewport
- **THEN** the gate actions SHALL be visible and operable without horizontal scrolling

#### Scenario: AC-968 — The task view on a phone

- **WHEN** the owner opens a running task on a phone-sized viewport
- **THEN** its surfaces SHALL stay reachable, the pipeline SHALL be behind one disclosure, and selecting a step in it SHALL change the thread rather than open a layer over it

### Requirement: REQ-912 — Decisions are cards, not log lines

An open decision SHALL appear in the task view visually distinct from ordinary thread
entries, rendering its question as markdown, offering its options as direct actions alongside a
free-text answer and an entry to its scoped discussion, and stating plainly when the task is
stopped on it. While the decision is open it SHALL be presented as the head of the one input
that answers it (REQ-921) rather than as a separate surface above that input or inside the
task's history: the question and the field that answers it are one thing, and a border between
them is a place for the question to scroll out of view. Where more than one decision is open,
one SHALL be shown at a time and a decision the task is stopped on SHALL be shown ahead of one
that is merely open; the rest MUST NOT be stacked as further surfaces on the screen. The discussion SHALL
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
running, independently of conversation content, and SHALL sit in the console's own row of verbs
beside sending (REQ-921) rather than in the rail; its confirmation SHALL name the stage and the
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
the presentation of a node that has not run.

Every node of the pinned pipeline SHALL be listed, in the order it runs, including the nodes that
have not run yet: what happens next is the question a pipeline is read to answer, and a count of
what was folded away does not answer it. A node that has not run SHALL NOT be activatable — it
has no step to read, and offering to open one offers an empty room.

A rail row SHALL explain, on request, what its step is for in the owner's terms — not the role
that runs it or the edges it has, but why a person should care that it exists. That explanation
SHALL appear after the pointer has rested on the row, so that crossing the rail on the way
elsewhere does not set ten of them flashing, and at once on focus, since arriving by keyboard is
already deliberate. It MUST NOT be clipped by the rail's own scrolling or borders. A node with
nothing worth saying SHALL offer no explanation rather than a generic one.

Selecting a row SHALL land on the row that was selected. A row MUST NOT change its own geometry
when selected, and selecting the row already being read MUST NOT move the selection to another
row: both are movement the owner did not ask for, in a column read by position.

A rail row SHALL carry the node's name, a mark standing for its state, and at most one fact. That
fact SHALL be what the node cost or why it is not finished — a duration, an attempt count, a
failure — and MUST NOT restate what the mark already says: `passed` and `stopped` written beside
a coloured mark are the mark's own meaning spelled again, in the column meant for what the node
actually cost. Where the state's word is the only thing a screen reader can be given, it SHALL be
carried for that reader alone. A row MUST NOT carry the model, the accepted commit, or the spend:
those belong to the step, and a row holding them had no width left for the node's own name.

Activating a node SHALL make the thread read that node's step (REQ-919), headed by the facts of
its runs — duration, token use, cost, model and the effort it was bound at, the role, and the
accepted commit. The rail SHALL mark the step being read. Where the step being read is the one
the task itself stands on, its head MUST NOT restate the state the page header (REQ-920) already
states of the task; where the owner has gone back to an earlier step, the head SHALL state that
step's own state, because the page header is then about a different node. An attempt SHALL be
numbered only where its node has run more than once. An
accepted commit SHALL be rendered in short form with its full value available, linked to the
commit wherever the repository's web address is derivable. The view MUST NOT present a running
attempt's uncommitted file edits as accepted changes; new code or artifact content becomes visible
only after the stage result and commit are accepted. The transcript, rail, thread, input,
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
- **THEN** its node's step SHALL show run activity but SHALL NOT show those edits as accepted changes, and a later accepted completion SHALL expose its commit and refreshed artifacts

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
- **THEN** the thread SHALL read that node's step — its runs, their spend, and what they did — with the rail marking it as the step being read

#### Scenario: AC-981 — The whole walk, and only the reachable part of it

- **WHEN** the owner reads a task stopped part-way through its pipeline
- **THEN** the rail SHALL list every node of the pinned pipeline in order, and the nodes that have not run SHALL be shown without being activatable

#### Scenario: AC-982 — The state is a mark, not a word

- **WHEN** a node has finished, or has stopped for no reason beyond being stopped
- **THEN** its row SHALL carry a mark for that state and SHALL leave its fact column empty, rather than writing the state out beside the mark

#### Scenario: AC-987 — What a step is for, on request

- **WHEN** the owner rests the pointer on a rail row, or focuses it from the keyboard
- **THEN** what that step is for SHALL be shown in full, not cropped by the rail's scrolling or its border, and it SHALL NOT have appeared while the pointer was merely crossing the row

#### Scenario: AC-988 — Selecting a row does not move the rail

- **WHEN** the owner selects a rail row, including the one already being read
- **THEN** the selection SHALL be on the row selected, and no row SHALL change its size or position

#### Scenario: AC-983 — The step's head does not repeat the page

- **WHEN** the owner reads the step the task itself stands on
- **THEN** the step's head SHALL carry that step's facts without restating the state the page header already gives, and reading an earlier step SHALL restore that step's own state to its head

### Requirement: REQ-915 — The task view surfaces live stage activity, subordinate to accepted state

The task view SHALL distinguish what a run *changed* from what it merely *looked at*, and SHALL
keep only the first.

An activity that changes nothing the task owns — reading a file, searching, fetching, revising
its own plan — SHALL be reported while the run is under way as a single line at the end of that
step, naming the action in progress and what it is acting on, replaced in place as the run
proceeds. That line SHALL carry no timestamp, since it is always now, and SHALL leave no entry
behind once the run ends: a run that read forty files and changed two is two lines of record,
not forty-two.

An activity that changes something SHALL be a line of the step's record (REQ-919) naming what it
changed, and SHALL remain after the run that made it ends. An activity whose tool the view does
not recognize SHALL be treated as changing something, because the view cannot honestly claim
otherwise. The newest such line of a run still under way SHALL be marked visibly as in progress;
once that run ends it SHALL stop being marked as current, so that the outcome beneath it is the
fresher fact rather than one claim standing beside another.

Whatever names a file SHALL be rendered as its path within the repository. An agent reports
absolute paths inside its sandbox, and repeating the workspace root on every line spends the
width of the column before the line says anything.

A stage with no activity events SHALL still show as running, with a line saying so, without
implying that nothing is happening; absence of activity events MUST NOT be presented as an error
or stall.

#### Scenario: AC-940 — Activity appears while a stage runs

- **WHEN** a running stage's provider CLI reports an action that changes something
- **THEN** it SHALL appear as a line of that stage's step naming what it changed, marked as in progress, without a reload

#### Scenario: AC-941 — Accepted result demotes prior activity

- **WHEN** a stage's result is accepted after it reported activity
- **THEN** its step SHALL carry the accepted outcome beneath those lines, and none of them SHALL still be marked as in progress

#### Scenario: AC-942 — No activity yet

- **WHEN** a stage is running and no activity has been reported
- **THEN** the rail SHALL still show it as running, and the step SHALL carry one line saying the run is working, without presenting the absence of activity as a failure

#### Scenario: AC-978 — Reading is progress, not record

- **WHEN** a running stage reports a series of reads and searches
- **THEN** the step SHALL show one line naming the current one and replacing it as the run proceeds, and once the run ends none of them SHALL remain in the step's record

#### Scenario: AC-979 — A run that only read leaves its boundaries

- **WHEN** a stage that reported nothing but reads and searches is stopped
- **THEN** its step SHALL carry the run's start and its stop, and no line for anything it read

#### Scenario: AC-980 — A path is read, not decoded

- **WHEN** an activity names a file inside the run's sandbox
- **THEN** the line SHALL show the file's path within the repository, without the workspace root every other line would repeat
