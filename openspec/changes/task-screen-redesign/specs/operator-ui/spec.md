## ADDED Requirements

### Requirement: REQ-918 — The task's history reads as a conversation, chaptered by stage

The task view SHALL group its timeline into chapters, one per stage attempt, each naming the
stage it covers and carrying that attempt's duration, token use, cost, and accepted commit
where those were recorded. An owner comment or conversation turn written while a stage was
running SHALL appear inside that stage's chapter, so the task conversation and the run ledger
read as one thread rather than two lists. Work done at a gate SHALL read as that gate's own
chapter. Only the newest chapter SHALL be open by default; every earlier one SHALL collapse
to a single line carrying its own summary, and a chapter the owner opens or closes SHALL stay
that way as new events arrive. A chapter MUST NOT repeat, as an entry inside itself, the
dispatch or transition that the chapter's own existence and title already state, nor the
duration, spend, or commit that the pinned pipeline states for the same node. An open decision
SHALL appear only where it is answered, never also as a history entry. New activity SHALL NOT
scroll the view away from an earlier chapter the owner is reading. Selecting one of the task's
artifacts SHALL render it in the thread's place, leaving the pipeline, spend, and gate controls
standing. Chapters and their controls SHALL be operable on a phone-sized viewport.

#### Scenario: AC-950 — Going back to an earlier stage

- **WHEN** the owner activates an earlier stage in the pinned pipeline
- **THEN** that stage's chapter SHALL open and come into view without leaving the task view

#### Scenario: AC-951 — History does not grow without end

- **WHEN** the owner opens a task whose pipeline has finished several stages
- **THEN** every chapter but the newest SHALL be collapsed to one line stating that stage's duration, token use, and cost

#### Scenario: AC-952 — A comment lands in the run it is about

- **WHEN** the owner comments while a stage is running
- **THEN** that comment SHALL appear inside that stage's chapter rather than in a chapter of its own

#### Scenario: AC-953 — Reading history while the task runs

- **WHEN** an event arrives while the owner is reading an earlier chapter
- **THEN** the entry SHALL be appended without moving the owner away from what they are reading

#### Scenario: AC-956 — A question is one thing on the screen

- **WHEN** a task has open questions and the owner opens it
- **THEN** each question SHALL be presented once, where it is answered, and SHALL NOT also appear as a history entry

#### Scenario: AC-957 — Reading a document without losing the task

- **WHEN** the owner opens one of the task's artifacts from the task view
- **THEN** it SHALL render in place, with the pipeline, spend, and anything waiting on the owner still visible

## MODIFIED Requirements

### Requirement: REQ-912 — Decisions are cards, not log lines

A decision SHALL appear in the task view as a card visually distinct from ordinary timeline
entries, rendering its question as markdown, offering its options as direct actions alongside
a free-text answer and an entry to its scoped discussion, and stating plainly when the task is
stopped on it. While the decision is open its card SHALL be presented with whatever else is
waiting on the owner rather than inside the task's history; once resolved it SHALL take its
place in the history at the point it was raised. A decision the task is stopped on SHALL be
presented ahead of one that is merely open. The discussion SHALL render as the decision's
conversation rather than as unrelated task comments. Answering or dismissing SHALL happen only
through an explicit control; afterwards the card SHALL show the outcome and offer no resolution
actions while retaining its readable discussion. Cards and discussion controls SHALL be operable
on a phone-sized viewport.

#### Scenario: AC-921 — A question arrives while watching

- **WHEN** a decision is raised on a task the owner has open
- **THEN** its card SHALL appear without a reload, presented with the task's other pending actions and marked as needing the owner

#### Scenario: AC-922 — Answering from the card

- **WHEN** the owner answers the last blocking decision from its card
- **THEN** the card SHALL show the answer and the view SHALL stop presenting the task as stopped, without a reload

#### Scenario: AC-923 — A resolved card is history

- **WHEN** a task with resolved decisions is reopened
- **THEN** their cards SHALL render the question with its answer or dismissal, in the chapter where the decision was raised, and offer no actions

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
action SHALL require a separate confirmation that names its target and effect. Restarting a
stage SHALL plainly state that uncommitted work from its interrupted attempt was discarded. A
direct `Stop current run` control SHALL be visible whenever a stage is running, independently of
conversation content; its confirmation SHALL name the stage and the loss of uncommitted work,
and its progress SHALL remain visible until the task is safely paused. Restart SHALL be a
separate control whose form SHALL accept optional guidance entered there or selected from a
conversation proposal, and confirmation SHALL show the exact instruction the replacement will
receive. The task view SHALL render the pinned pipeline as a rail that stays in view while the
history scrolls, listing every node with its live status and marking the node the task stands
on together with its live `running`, `stopping`, `paused`, or terminal state. Activating a node
SHALL reveal, in place, that node's runs — each with its status, duration, token use, cost, and
accepted commit — and, for a stage node, the role that runs it. A model binding SHALL be named
on a node only where it departs from the task's baseline binding, which the pipeline SHALL state
once. An attempt SHALL be numbered only where its node has run more than once. An accepted
commit SHALL be rendered in short form with its full value available, linked to the commit
wherever the repository's web address is derivable. Its chronological timeline SHALL show
durable stage, stop/cleanup/restart, conversation, action, decision, and accepted-artifact
events, grouped per REQ-918. It MUST NOT present a running attempt's uncommitted file edits as
accepted changes; new code or artifact content becomes visible only after the stage result and
commit are accepted. The transcript, pipeline, timeline, composer, stop/restart, and confirmation
controls SHALL be operable on a phone-sized viewport and update from task events without reload.

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
- **THEN** the pinned pipeline SHALL mark the current node with its state, and that node SHALL name its runs and its last accepted commit, without requiring the owner to infer them from chat

#### Scenario: AC-938 — Activity is not a live file feed

- **WHEN** a running attempt changes files before its result is accepted
- **THEN** the timeline SHALL show run activity but SHALL NOT show those edits as accepted changes, and a later accepted completion SHALL expose its commit and refreshed artifacts

#### Scenario: AC-954 — A first attempt is not numbered

- **WHEN** the owner opens a task whose current node has run exactly once
- **THEN** the view SHALL present that run without an attempt number, and SHALL number the runs as soon as the node runs again

#### Scenario: AC-955 — An accepted commit is legible

- **WHEN** a stage has accepted a commit and the task's repository is hosted where a commit URL is derivable
- **THEN** the view SHALL show the commit in short form, carry its full value, and link to that commit
