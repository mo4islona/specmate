## MODIFIED Requirements

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

Where such a line carries the edit it made (REQ-212), the record SHALL show that edit and not
only the fact of it: the count of lines added and removed, and the diff itself, with its line
numbers and its added and removed lines distinguished by more than punctuation. A record saying
a file was written, and not what it now says, is a record of nothing. The rendered diff SHALL be
clamped to a height that leaves the step readable as a record, and a clamped or truncated diff
SHALL say so and offer the whole edit, which MUST NOT require leaving the surface the owner is
on. A line carrying no edit keeps its single line.

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

#### Scenario: AC-992 — An edit reads as the edit

- **WHEN** the record renders a line whose activity carried an edit
- **THEN** it SHALL show the added and removed line counts and the diff, with line numbers and its added and removed lines visually distinguished

#### Scenario: AC-993 — A long edit stays a line of a record

- **WHEN** the rendered diff is longer than the record's clamp
- **THEN** the line SHALL show the clamped diff, say that it is clamped, and offer the whole edit without navigating away from the surface

#### Scenario: AC-994 — An action that edited nothing

- **WHEN** the record renders a line whose activity carried no edit
- **THEN** it SHALL stay a single line naming the action and its target, unchanged by this requirement
