## MODIFIED Requirements

### Requirement: REQ-907 — Artifacts render as documents

The task's documents SHALL be one of its surfaces (REQ-920), listing the task's artifacts and
rendering a selected artifact's markdown as a readable document — headings, lists, tables, code
blocks — not as raw text. A document SHALL also be readable in the step whose runs wrote it
(REQ-919), without leaving the thread: the surface is the index of everything the task holds,
and the step is where its own output is read.

A document SHALL be named by what it is — its artifact kind — and never by the file holding it.
The file's name is one spec convention's word for the same thing (REQ-1701), so a listing built
on it says the wrong word, or none at all, for a repository laid out another way; and where the
two agree, a listing carrying both says one thing twice. Where a kind holds more than one
document the listing SHALL also carry what tells them apart, which for a specification is the
capability it is for and never its file name, every capability's specification being written to
the same one.

The listing SHALL be ordered so that it reads — the change stated, then what the owner settled
about it, then how it is planned, then how it is judged, then how it is closed — and MUST NOT be
ordered by how the documents happen to be stored. The decision log belongs with the statement of
the change and not at the end: it is no stage's output, and everything below it is bound by it.

The path a document is stored at SHALL be shown on the document itself and nowhere else. Under
every row of a listing it is one string, the same on all of them, truncated by the rail's own
width before it reaches whatever could have differed.

Opening the surface SHALL open a document. A pane asking which one to open, beside a listing
short enough to read at a glance, spends the surface on an instruction.

In a step, the documents SHALL be presented as a shelf and not a stack: each named as above, each
stating how much of it there is — including that there is none — and at most one of them open at
a time. An open document SHALL be clamped to a readable height with a control that opens the
whole of it in place, and a way to open it on the documents surface. It MUST NOT expand inside a
scrolling region of its own, because the thread is one scrolling region (REQ-919) and a box that
scrolls within it is a fold. Rendering every document open and full-length is what put a decision
log saying nothing at the same size as the proposal it followed, and pushed the console under the
fold to do it.

An artifact updated by a later stage SHALL show its fresh content when reopened. The number of
documents SHALL be carried by that surface's own tab and stated nowhere else.

#### Scenario: AC-913 — Reading a proposal

- **WHEN** the owner opens the task's proposal artifact
- **THEN** it SHALL render as formatted markdown

#### Scenario: AC-914 — Artifact updated between visits

- **WHEN** a stage rewrites an artifact and the owner reopens it
- **THEN** the rendered content SHALL be the updated version

#### Scenario: AC-1810 — A document is named for what it is

- **WHEN** the owner opens a task's documents surface
- **THEN** each document SHALL be listed under the name of its kind, with neither the file holding it nor the folder that folder sits in drawn beside it

#### Scenario: AC-1811 — Two specifications in one change

- **WHEN** a task's documents include a specification for more than one capability
- **THEN** each SHALL be listed under the same kind name, told apart by the capability it is for

#### Scenario: AC-1812 — The listing reads in order

- **WHEN** a task's documents include both a decision log and a summary
- **THEN** the decision log SHALL be listed with the proposal and the summary last, whatever order the documents were stored or written in

#### Scenario: AC-1813 — The surface opens on a document

- **WHEN** the owner opens a task's documents surface without naming one
- **THEN** a document SHALL be open and rendered, not an instruction to select one

### Requirement: REQ-916 — Files changed, PR-style

The task view SHALL offer a Files-Changed view covering every file the task's code diff reports
(REQ-1013), grouped by the directory it sits in, under a heading naming that directory. A
directory heading SHALL name its whole path, shortened from the front where it does not fit,
since the end of a path is what tells two of them apart. The listing MUST NOT nest further than a
directory and its files: a reader following a path down and back up loses the place they were
reading. Each file SHALL carry its change status and line counts, and a filter SHALL narrow the
listing to the paths matching it. The count the surface's tab carries SHALL be the count of the
files that comparison holds. A task with nothing changed SHALL show an explicit empty state
rather than a blank list, and that state SHALL say where the task's own documents are, so that a
count of zero is read as "no code yet" rather than as "nothing has happened".

Every file's diff SHALL be on the surface at once, each rendered as a readable document, not raw
text, under a header naming its path, its status and its line counts. Selecting a file in the
listing SHALL bring that file's diff into view without navigating away from the surface and
without displacing any other. A file's diff MAY be collapsed, and one longer than the surface can
hold as a single document SHALL be clamped, SHALL say that it is clamped, and SHALL offer the
rest without leaving the surface.

The surface SHALL let the reader mark a file as viewed, and SHALL report the pass as the number
of files marked out of the number the comparison contains. That total MUST NOT follow the filter:
a filter narrows what is drawn, not what the pass is over. A mark is a claim about the diff it
was left on — marks MUST NOT survive the comparison moving, and a surface whose comparison has
moved SHALL say so rather than present an emptied pass as one never started.

The reader SHALL be able to widen the context surrounding a hunk in place, and to read the
surface's diffs either as one column or as two, that choice holding across visits. Where the
surface is too narrow to carry two columns the diffs SHALL be drawn as one, and the choice SHALL
NOT be offered rather than offered and ignored.

A file's diff SHALL also be openable as a layer over the surface the owner is on, reachable from
a file named anywhere else in the task view; closing that layer SHALL return the owner to exactly
what they were reading.

#### Scenario: AC-943 — Opening the Files-Changed view

- **WHEN** the owner opens a task's Files-Changed view
- **THEN** every changed file SHALL be listed under a heading naming its directory, with its status and line counts

#### Scenario: AC-944 — Reading one file's diff

- **WHEN** the owner selects a file from the listing
- **THEN** that file's diff SHALL be brought into view on the same surface, every other file's diff still on it

#### Scenario: AC-945 — No changes yet

- **WHEN** a task with nothing changed opens its Files-Changed view
- **THEN** it SHALL show an explicit empty state instead of a blank list

#### Scenario: AC-995 — A task that has only written specifications

- **WHEN** the owner opens the Files-Changed view of a task that has written documents into its change folder and no product code
- **THEN** the surface SHALL be empty and SHALL name the documents surface as where those documents are read

#### Scenario: AC-996 — A diff opened from elsewhere in the task

- **WHEN** the owner opens the diff of a file named outside the Files-Changed view
- **THEN** it SHALL open as a layer over the surface being read, and closing it SHALL leave that surface as it was

#### Scenario: AC-997 — A file with no diff to show

- **WHEN** the owner opens the diff of a file the task's comparison has nothing for
- **THEN** the layer SHALL say so rather than render as empty

#### Scenario: AC-1800 — Narrowing a large comparison

- **WHEN** the owner types into the surface's filter
- **THEN** the listing and the diffs drawn beside it SHALL narrow to the matching paths, and the pass's total SHALL still count every file the comparison contains

#### Scenario: AC-1801 — Marking a file viewed

- **WHEN** the owner marks a file as viewed
- **THEN** that file SHALL show as viewed and the surface's pass SHALL advance by one

#### Scenario: AC-1802 — The comparison moves under the pass

- **WHEN** the owner returns to a Files-Changed view whose task has committed since files were marked viewed
- **THEN** no file SHALL still show as viewed, and the surface SHALL say the comparison has moved

#### Scenario: AC-1803 — Widening a hunk

- **WHEN** the owner widens the context around a hunk
- **THEN** the surrounding lines SHALL be drawn in place, without that file leaving the surface

#### Scenario: AC-1804 — Two columns instead of one

- **WHEN** the owner chooses to read the surface's diffs as two columns
- **THEN** removed and added lines SHALL be drawn side by side, and that choice SHALL still hold the next time the view is opened
