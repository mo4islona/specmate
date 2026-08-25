## MODIFIED Requirements

### Requirement: REQ-916 — Files changed, PR-style

The task view SHALL offer a Files-Changed view covering every file the task's code diff reports,
grouped first by what the file is — the specification the task wrote, or the product code it
changed — and within each of those by the directory it sits in, under a heading naming that
directory. A directory heading SHALL name its whole path, shortened from the front where it does
not fit, since the end of a path is what tells two of them apart. The listing MUST NOT nest
further than a directory and its files: a reader following a path down and back up loses the
place they were reading. Each file SHALL carry its change status and line counts, and a filter
SHALL narrow the listing to the paths matching it. The count the surface's tab carries SHALL be
the count of everything the task changed, both groups together. A task with nothing changed SHALL
show an explicit empty state rather than a blank list.

Every file's diff SHALL be on the surface at once, each rendered as a readable document, not raw
text, under a header naming its path, its status and its line counts. Selecting a file in the
listing SHALL bring that file's diff into view without navigating away from the surface and
without displacing any other. A file's diff MAY be collapsed, and one longer than the surface can hold as
a single document SHALL be clamped, SHALL say that it is clamped, and SHALL offer the rest
without leaving the surface.

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

- **WHEN** the owner opens the Files-Changed view of a task that has written specifications and no product code
- **THEN** those files SHALL appear under the group naming them as specification, and the surface's tab SHALL count them

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
